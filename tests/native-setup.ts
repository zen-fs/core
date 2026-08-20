// SPDX-License-Identifier: LGPL-3.0-or-later
/* Run the FS test suite against native node:fs.
Since the tests use absolute paths, everything is contained to a scratch directory using chroot-style path mapping. */
import * as native from 'node:fs';
import type { TestFlag, TestFlagState } from './common.ts';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySync, data, tmp } from './setup.ts';
import { styleText } from 'node:util';
import { isRoot } from 'utilium/node';

// The tests assume modes are used as-is, but native fs applies the process umask
process.umask(0);

// Test files run in parallel processes, so each process gets its own scratch directory
const root = native.mkdtempSync(join(tmp, 'native-'));

/** Restore directory modes so the scratch directory can be removed (e.g. after permissions tests chmod 0o000) */
function makeRemovable(path: string): void {
	try {
		if (!native.lstatSync(path).isDirectory()) return;
		native.chmodSync(path, 0o755);
		for (const entry of native.readdirSync(path)) makeRemovable(join(path, entry));
	} catch {
		// The cleanup is best-effort; rmSync will report anything unremovable
	}
}

process.on('exit', () => {
	makeRemovable(root);
	native.rmSync(root, { recursive: true, force: true });
});

type PathLike = string | Buffer | URL;

function isPath(value: unknown): value is PathLike {
	return typeof value == 'string' || value instanceof Buffer || value instanceof URL;
}

/** Translate a test path into the scratch directory */
function toNative(path: PathLike): string {
	if (path instanceof URL) path = fileURLToPath(path);
	path = path.toString();
	// Do not map the empty path, so it still results in ENOENT
	if (!path) return path;
	return join(root, resolve('/', path));
}

/** Translate a native path back into a test path */
function fromNative(path: string): string {
	if (!isAbsolute(path)) return path;
	return resolve('/', relative(root, path));
}

/** How many leading arguments are paths */
const pathArgs: Record<string, number> = {
	access: 1,
	appendFile: 1,
	chmod: 1,
	chown: 1,
	copyFile: 2,
	cp: 2,
	createReadStream: 1,
	createWriteStream: 1,
	exists: 1,
	glob: 1,
	lchmod: 1,
	lchown: 1,
	link: 2,
	lstat: 1,
	lutimes: 1,
	mkdir: 1,
	mkdtemp: 1,
	mkdtempDisposable: 1,
	open: 1,
	opendir: 1,
	readFile: 1,
	readdir: 1,
	readlink: 1,
	realpath: 1,
	rename: 2,
	rm: 1,
	rmdir: 1,
	stat: 1,
	statfs: 1,
	truncate: 1,
	unlink: 1,
	unwatchFile: 1,
	utimes: 1,
	watch: 1,
	watchFile: 1,
	writeFile: 1,
};

/** Functions whose result is a path that needs to be translated back. Note `mkdir` returns the first created path when recursive */
const returnsPath = new Set(['realpath', 'mkdtemp', 'readlink', 'mkdir']);

function mapArgs(base: string, args: unknown[]): unknown[] {
	const out = [...args];

	if (base == 'symlink') {
		/* Absolute targets must be mapped so resolution can't escape the scratch directory.
		Relative targets resolve against the link's parent, which is already inside. */
		if (isPath(out[0]) && isAbsolute(out[0].toString())) out[0] = toNative(out[0]);
		if (isPath(out[1])) out[1] = toNative(out[1]);
		return out;
	}

	for (let i = 0; i < (pathArgs[base] ?? 0); i++) {
		const arg = out[i];
		if (isPath(arg)) out[i] = toNative(arg);
	}
	return out;
}

function mapResult(base: string, result: unknown): unknown {
	if (returnsPath.has(base) && typeof result == 'string') return fromNative(result);

	// `Dirent.parentPath` is a real path, so it needs to be mapped back too
	if (base == 'readdir' && Array.isArray(result)) {
		for (const entry of result) {
			if (typeof entry?.parentPath == 'string') entry.parentPath = fromNative(entry.parentPath);
		}
	}

	// `mkdtempDisposable` returns the path on an object. Disposal uses the path it captured, so this is safe to change.
	const disposable = result as { path?: unknown };
	if (base == 'mkdtempDisposable' && typeof disposable?.path == 'string') disposable.path = fromNative(disposable.path);

	return result;
}

/**
 * Functions whose last argument is an event listener, not a `(err, result)` callback.
 * Wrapping those would change the listener's identity, so `unwatchFile` could not remove it.
 */
const listenerAPIs = new Set(['watch', 'watchFile', 'unwatchFile']);

/** Translate native paths in errors back into test paths */
function mapError(error: unknown): unknown {
	if (!error || typeof error != 'object') return error;
	const e = error as Record<string, unknown>;

	for (const key of ['path', 'dest'] as const) {
		if (typeof e[key] == 'string' && e[key].startsWith(root)) e[key] = fromNative(e[key]);
	}
	if (typeof e.message == 'string') e.message = e.message.replaceAll(root, '');

	return error;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function wrap(name: string, fn: Function, promise: boolean): Function {
	const base = name.endsWith('Sync') ? name.slice(0, -4) : name;

	if (promise) {
		return async function (...args: unknown[]) {
			try {
				return mapResult(base, await fn(...mapArgs(base, args)));
			} catch (e) {
				throw mapError(e);
			}
		};
	}

	return function (...args: unknown[]) {
		const mapped = mapArgs(base, args);

		// Map paths in callback errors and results (e.g. realpath(path, cb))
		const cb = mapped.at(-1);
		if (typeof cb == 'function' && !listenerAPIs.has(base)) {
			mapped[mapped.length - 1] = (err: unknown, result: unknown, ...rest: unknown[]) => cb(mapError(err), mapResult(base, result), ...rest);
		}

		try {
			return mapResult(base, fn(...mapped));
		} catch (e) {
			throw mapError(e);
		}
	};
}

const wrapped: Record<string, unknown> = {};

for (const [key, value] of Object.entries(native)) {
	if (key == 'promises') continue;
	// Classes (Stats, Dirent, ReadStream, ...) must not be wrapped, or `instanceof` breaks
	wrapped[key] = typeof value == 'function' && !/^[A-Z]/.test(key) ? wrap(key, value, false) : value;
}

// `using` support, which node:fs does not have (yet?)
wrapped.watch = function (...args: Parameters<typeof native.watch>) {
	const watcher = native.watch(...(mapArgs('watch', args) as Parameters<typeof native.watch>));
	(watcher as any)[Symbol.dispose] ??= () => watcher.close();
	(watcher as any)[Symbol.asyncDispose] ??= () => watcher.close();
	return watcher;
};

const promises: Record<string, unknown> = {};

for (const [key, value] of Object.entries(native.promises)) {
	promises[key] = typeof value == 'function' && !/^[A-Z]/.test(key) ? wrap(key, value, true) : value;
}

// promises.watch returns an async iterable, not a promise, so it must not be awaited
promises.watch = (...args: Parameters<typeof native.promises.watch>) =>
	native.promises.watch(...(mapArgs('watch', args) as Parameters<typeof native.promises.watch>));

wrapped.promises = promises;

export const fs = wrapped as unknown as typeof native;

/** So tests can check `stats instanceof Stats` against the correct class */
export const Stats = native.Stats;

export const flags: Partial<Record<TestFlag, TestFlagState>> = {
	// Node only implements `lchmod` on macOS
	lchmod: process.platform == 'darwin',
	// The suite uses ZenFS' own extended attribute API, which `node:fs` does not have
	xattr: false,
	'promises.exists': false,
	root: isRoot || 'skip',
};

copySync(data, fs);

// Kill genuinely hung processes without keeping finished ones alive
setTimeout(() => {
	console.error(styleText(['yellow', 'bold'], 'Process took longer than 5s and was killed.'));
	process.exit(255);
}, 5_000).unref();
