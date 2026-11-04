// SPDX-License-Identifier: LGPL-3.0-or-later
import { Buffer } from 'buffer';
import { Errno, withErrno, type Exception } from 'kerium';
import type * as fs from 'node:fs';
import type { Worker as NodeWorker } from 'node:worker_threads';
import type { OptionalTuple } from 'utilium';
import { resolve } from './path.js';
import type { V_Context } from './internal/contexts.js';

export type Callback<Args extends unknown[] = [], NoError = null> = (e: Exception | NoError, ...args: OptionalTuple<Args>) => unknown;

/**
 * Normalizes a mode
 * @param def default
 * @internal
 */
export function normalizeMode(mode: unknown, def?: number): number {
	if (typeof mode == 'number') return mode;

	if (typeof mode == 'string') {
		const parsed = parseInt(mode, 8);
		if (!isNaN(parsed)) {
			return parsed;
		}
	}

	if (typeof def == 'number') return def;

	throw withErrno('EINVAL', 'Invalid mode: ' + mode?.toString());
}

/**
 * The largest valid file descriptor, since Node validates them as 32-bit signed integers
 * @internal @hidden
 */
const fd_max = 0x7fffffff;

/**
 * Checks that `fd` is in the range Node accepts for a file descriptor.
 * Note this throws a `RangeError` rather than an `Exception`, since that is what Node does.
 * @internal
 */
export function validateFD(fd: number): void {
	if (Number.isInteger(fd) && fd >= 0 && fd <= fd_max) return;

	throw Object.assign(new RangeError(`The value of "fd" is out of range. It must be >= 0 && <= ${fd_max}. Received ${fd}`), {
		code: 'ERR_OUT_OF_RANGE',
	});
}

/**
 * Whether an error means the path does not resolve to an entry. Used for `throwIfNoEntry`.
 * @internal @hidden
 */
export function _isNoEntry(e: unknown): boolean {
	const { code } = (e ?? {}) as Exception;
	return code == 'ENOENT' || code == 'ENOTDIR';
}

/**
 * Normalizes a time to milliseconds since the epoch.
 * Note numbers and numeric strings are seconds, like Node's `toUnixTimestamp`.
 * @internal
 */
export function normalizeTime(time: fs.TimeLike): number {
	// Dates are already in milliseconds
	if (time instanceof Date) return time.getTime();

	const seconds = Number(time);

	if (!Number.isFinite(seconds)) throw withErrno('EINVAL', 'Invalid time.');

	// Negative times mean "now"
	return seconds < 0 ? Date.now() : seconds * 1000;
}

/**
 * Normalizes a path
 * @internal
 * @todo clean this up and make it so `path.resolve` is only called when an explicit context is passed (i.e. `normalizePath(..., $)` to use `path.resolve`)
 */
export function normalizePath(this: V_Context, p: fs.PathLike, noResolve: boolean = false): string {
	if (typeof p == 'number')
		throw Object.assign(
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			new TypeError(`The "path" argument must be of type string or an instance of Buffer or URL. Received type number (${p})`),
			{ code: 'ERR_INVALID_ARG_TYPE' },
		);
	if (p instanceof URL) {
		if (p.protocol != 'file:') throw withErrno('EINVAL', 'URLs must use the file: protocol');
		p = p.pathname;
	}
	p = p.toString();
	if (p.startsWith('file://')) p = p.slice('file://'.length);
	if (p.includes('\x00')) throw withErrno('EINVAL', 'Path can not contain null character');
	if (p.length == 0) throw withErrno('EINVAL', 'Path can not be empty');
	p = p.replaceAll(/[/\\]+/g, '/');

	// Note: PWD is not resolved here, it is resolved later.
	return noResolve ? p : resolve.call(this, p);
}

/**
 * Throws Node's `ERR_INVALID_ARG_TYPE` unless `data` is a string or an `ArrayBufferView`.
 * @internal @hidden
 */
export function validateData(data: unknown, name: string = 'data'): asserts data is string | ArrayBufferView {
	if (typeof data == 'string' || ArrayBuffer.isView(data)) return;
	throw Object.assign(
		new TypeError(
			`The "${name}" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ${data === null ? 'null' : typeof data}`,
		),
		{ code: 'ERR_INVALID_ARG_TYPE' },
	);
}

/**
 * Creates Node's error for copying a directory onto a non-directory, or a non-directory onto a directory.
 * @internal @hidden
 */
export function _cpTypeMismatch(source: string, destination: string, sourceIsDirectory: boolean): Error {
	const [code, errno, sourceType, destinationType] = sourceIsDirectory
		? (['ERR_FS_CP_DIR_TO_NON_DIR', 'EISDIR', 'directory', 'non-directory'] as const)
		: (['ERR_FS_CP_NON_DIR_TO_DIR', 'ENOTDIR', 'non-directory', 'directory'] as const);
	const message = `cannot overwrite ${destinationType} ${destination} with ${sourceType} ${source}`;
	return Object.assign(new Error(`Cannot overwrite ${destinationType} with ${sourceType}: cp returned ${errno} (${message}) ${destination}`), {
		name: 'SystemError',
		code,
		errno: Errno[errno],
		syscall: 'cp',
		path: destination,
	});
}

/**
 * Throws Node's `ERR_OUT_OF_RANGE` unless `maxDepth` is `Infinity` or a non-negative integer.
 * @internal @hidden
 */
export function _validateMaxDepth(maxDepth: number): void {
	if (maxDepth === Infinity || (Number.isSafeInteger(maxDepth) && maxDepth >= 0)) return;
	const requirement = Number.isInteger(maxDepth) ? '>= 0 && <= 9007199254740991' : 'an integer';
	throw Object.assign(new RangeError(`The value of "options.maxDepth" is out of range. It must be ${requirement}. Received ${maxDepth}`), {
		code: 'ERR_OUT_OF_RANGE',
	});
}

/**
 * Describes a value the way Node's argument errors do, e.g. `type string ('x')`.
 * @internal @hidden
 */
export function _describeReceived(value: unknown): string {
	if (value == null) return String(value);
	if (typeof value == 'function') return `function ${value.name}`;
	if (typeof value == 'object') return value.constructor?.name ? `an instance of ${value.constructor.name}` : String(value);
	return `type ${typeof value} (${typeof value == 'string' ? `'${value}'` : String(value)})`;
}

/**
 * Resolves the `buffer` option of `readFile` into a buffer covering the first `size` bytes of the view.
 * @internal @hidden
 */
export function _readFileBuffer(into: ArrayBufferView | ((size: number) => ArrayBufferView), size: number): Buffer {
	const isFunction = typeof into == 'function';
	const view: unknown = isFunction ? into(size) : into;
	const name = isFunction ? 'options.buffer()' : 'options.buffer';

	if (!ArrayBuffer.isView(view))
		throw Object.assign(
			new TypeError(
				`The "options.buffer" property must be of type function or an instance of Buffer, TypedArray, or DataView. Received ${_describeReceived(view)}`,
			),
			{ code: 'ERR_INVALID_ARG_TYPE' },
		);

	if (view.byteLength < size)
		throw Object.assign(
			new TypeError(`The property '${name}.byteLength' is smaller than the file size of ${size} bytes. Received ${view.byteLength}`),
			{ code: 'ERR_INVALID_ARG_VALUE' },
		);

	return Buffer.from(view.buffer, view.byteOffset, size);
}

/**
 * Creates Node's `AbortError` for an aborted `signal`.
 * @internal @hidden
 */
export function _abortError(signal: AbortSignal): Error {
	return Object.assign(new Error('The operation was aborted', { cause: signal.reason }), { name: 'AbortError', code: 'ABORT_ERR' });
}

/**
 * Runs `operation`, rejecting with Node's `AbortError` if `signal` is aborted before it settles.
 * @internal @hidden
 */
export async function _raceSignal<T>(operation: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
	if (!signal) return await operation();
	if (signal.aborted) throw _abortError(signal);

	const { promise, reject } = Promise.withResolvers<never>();
	const onAbort = () => reject(_abortError(signal));
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		return await Promise.race([operation(), promise]);
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

/**
 * Normalizes options
 * @param options options to normalize
 * @param encoding default encoding
 * @param flag default flag
 * @param mode default mode
 * @internal
 */
export function normalizeOptions(
	options: fs.WriteFileOptions | (fs.EncodingOption & { flag?: fs.OpenMode }) | undefined,
	encoding: BufferEncoding | null = 'utf8',
	flag: string,
	mode: number = 0,
): fs.ObjectEncodingOptions & { flag: string; mode: number } {
	if (typeof options != 'object' || options === null) {
		return {
			encoding: typeof options == 'string' ? options : (encoding ?? null),
			flag,
			mode,
		};
	}

	return {
		encoding: typeof options?.encoding == 'string' ? options.encoding : (encoding ?? null),
		flag: typeof options?.flag == 'string' ? options.flag : flag,
		mode: normalizeMode('mode' in options ? options?.mode : null, mode),
	};
}

export async function waitOnline(worker: NodeWorker): Promise<void> {
	const online = Promise.withResolvers<void>();
	setTimeout(() => online.reject(withErrno('ETIMEDOUT')), 500);
	worker.on('online', online.resolve);
	await online.promise;
}

/**
 * @internal @hidden
 */
export function _tempDirName(prefix: fs.PathLike) {
	// Like Node, the prefix is a path. A relative one is resolved against the working directory, not `/tmp`.
	return `${normalizePath(prefix, true)}${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Resolves the global `Temporal`, which is not implemented by all runtimes.
 * @internal @hidden
 */
export function _temporal(): typeof Temporal {
	if ('Temporal' in globalThis && typeof globalThis.Temporal !== 'undefined') return globalThis.Temporal;
	throw withErrno('ENOTSUP', 'Temporal is not supported by this runtime');
}
