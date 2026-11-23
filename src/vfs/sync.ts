// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Mode, PathLike, TimeLike } from 'node:fs';
import type { V_Context } from '../context.js';
import type { InodeLike } from '../internal/inode.js';
import type { MkdirOptions, OpenOptions, ReaddirOptions, ResolvedPath } from './shared.js';

import { setUVMessage, UV, type ExceptionExtra } from 'kerium';
import { decodeUTF8 } from 'utilium';
import * as constants from '../constants.js';
import { applyUmask, contextOf } from '../internal/contexts.js';
import { wrap } from '../internal/error.js';
import { assertRemovable, assertSearchable, hasAccess, isDirectory, isSymbolicLink } from '../internal/inode.js';
import { basename, dirname, join, parse, resolve as resolvePath } from '../path.js';
import { normalizeMode, normalizePath, normalizeTime } from '../utils.js';
import { cacheOf } from './vcache.js';
import { checkAccess, resolveFullWalk } from './config.js';
import { type Dirent, ifToDt } from './dir.js';
import { Handle } from './file.js';
import * as flags from './flags.js';
import { maxSymlinks, resolveMount, walkComponents, type Walk } from './shared.js';
import { emitChange } from './watchers.js';

/**
 * Resolves the mount and real path for a path.
 * Additionally, any stats fetched will be returned for de-duplication
 * @category VFS
 * @internal @hidden
 */
export function resolve($: V_Context, path: string, preserveSymlinks?: boolean, extra?: ExceptionExtra): ResolvedPath {
	path = resolvePath.call($, path);
	/* Try to resolve it directly. If this works,
	that means we don't need to perform any resolution for parent directories. */
	let isLink = false;
	if (!resolveFullWalk)
		try {
			const resolved = resolveMount(path, $);

			// Stat it to make sure it exists. The vnode cache takes precedence since it may have unsynced changes
			const stats = resolved.cache.statSync(resolved.path);

			if (!isSymbolicLink(stats) || preserveSymlinks) {
				return { ...resolved, fullPath: path, stats };
			}

			isLink = true;
		} catch {
			// Go the long way
		}

	const direct = isLink && followDirect($, dirname(path), readlink.call($, path));
	if (direct) return { ...resolveMount(direct.path, $), fullPath: direct.path, stats: direct.stats };

	const walk: Walk = { original: path, preserveSymlinks, extra };
	if (path == '/') return resolveWalk($, walk, '/', statReal($, '/'), []);

	const parent = resolve($, dirname(path), false, extra);
	if (parent.stats) return resolveWalk($, walk, parent.fullPath, parent.stats, [basename(path)]);

	const fullPath = join(parent.fullPath, basename(path));
	return { ...resolveMount(fullPath, $), fullPath };
}

function statReal($: V_Context, real: string): InodeLike {
	const { cache, path } = resolveMount(real, $);
	return cache.statSync(path);
}

/**
 * Resolves a symbolic link's target in one lookup, when it has no `..` and no symbolic links along it.
 */
function followDirect($: V_Context, real: string, target: string): { path: string; stats: InodeLike } | undefined {
	if (target.split('/').includes('..')) return;
	const path = resolvePath.call($, real, target);
	try {
		const stats = statReal($, path);
		if (!isSymbolicLink(stats)) return { path, stats };
	} catch {
		return;
	}
}

/**
 * Resolves the `pending` components, last first, from the real directory `real`.
 * Symbolic links are followed before the components after them, so `..` always applies to a real parent.
 */
function resolveWalk($: V_Context, walk: Walk, real: string, stats: InodeLike, pending: string[]): ResolvedPath {
	const { preserveSymlinks, extra } = walk;
	const $ex = { syscall: 'stat', path: walk.original, ...extra };
	let links = 0;

	while (pending.length) {
		const name = pending.pop()!;
		if (!isDirectory(stats)) throw UV('ENOTDIR', $ex);
		if (name == '.') continue;

		if (name == '..') {
			real = dirname(real);
			stats = statReal($, real);
			continue;
		}

		assertSearchable($, stats, $ex);

		const next = join(real, name);
		const resolved = resolveMount(next, $);
		let nextStats: InodeLike;
		try {
			nextStats = resolved.cache.statSync(resolved.path);
		} catch (e: any) {
			if (e.code !== 'ENOENT') throw setUVMessage(Object.assign(e, { syscall: 'stat', path: next, ...extra }));
			const fullPath = join(next, ...pending.reverse());
			return { ...resolveMount(fullPath, $), fullPath };
		}

		if (!isSymbolicLink(nextStats) || (preserveSymlinks && !pending.length)) {
			real = next;
			stats = nextStats;
			continue;
		}

		if (++links > maxSymlinks) throw UV('ELOOP', $ex);
		const target = readlink.call($, next);
		const direct = followDirect($, real, target);
		if (direct) {
			real = direct.path;
			stats = direct.stats;
			continue;
		}

		pending.push(...walkComponents(target));
		if (!target.startsWith('/')) continue;
		real = '/';
		stats = statReal($, real);
	}

	return { ...resolveMount(real, $), fullPath: real, stats };
}

/**
 * @category VFS
 * @internal
 */
export function open($: V_Context, path: PathLike, opt: OpenOptions): Handle {
	path = normalizePath.call($, path);
	const mode = normalizeMode(opt.mode, 0o644),
		flag = flags.parse(opt.flag);

	path = resolve($, path, opt.preserveSymlinks).fullPath;
	const { fs, cache, path: resolved } = resolveMount(path, $);

	let stats: InodeLike | undefined;
	try {
		stats = cache.statSync(resolved);
	} catch {
		// nothing
	}

	if (!stats) {
		if (!(flag & constants.O_CREAT)) {
			throw UV('ENOENT', 'open', path);
		}
		// Create the file
		const parentPath = dirname(resolved);
		const parentStats = cache.statSync(parentPath, { syscall: 'open', path });
		if (checkAccess && !hasAccess($, parentStats, constants.W_OK | constants.X_OK)) {
			throw UV('EACCES', 'open', path);
		}

		if (!isDirectory(parentStats)) {
			throw UV('ENOTDIR', 'open', path);
		}

		if (!opt.allowDirectory && isDirectory({ mode })) throw UV('EISDIR', 'open', path);

		// Serialize entry creation with other operations on the parent directory
		using _ = cache.lockSync(parentPath, 'rw', parentStats);

		const { euid: uid, egid: gid } = contextOf($).credentials;
		const inode = fs.createFileSync(resolved, {
			mode: applyUmask($, mode),
			uid: parentStats.mode & constants.S_ISUID ? parentStats.uid : uid,
			gid: parentStats.mode & constants.S_ISGID ? parentStats.gid : gid,
		});

		// A new entry in the parent directory, which is a 'rename' event
		emitChange($, 'rename', path);

		return new Handle($, path, resolved, flag, cache.ref(resolved, inode));
	}

	if (checkAccess && !hasAccess($, stats, flags.toMode(flag))) {
		throw UV('EACCES', 'open', path);
	}

	if (flag & constants.O_EXCL) throw UV('EEXIST', 'open', path);
	if (!opt.allowDirectory && isDirectory(stats)) throw UV('EISDIR', 'open', path);

	const file = new Handle($, path, resolved, flag, cache.ref(resolved, stats));

	if (flag & constants.O_TRUNC) file.truncateSync(0);

	return file;
}

export function readlink(this: V_Context, path: PathLike): string {
	path = normalizePath.call(this, path);

	const { fs, stats, path: resolved } = resolve(this, path, true, { syscall: 'readlink' });

	if (!stats) throw UV('ENOENT', 'readlink', path);
	if (checkAccess && !hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', 'readlink', path);
	if (!isSymbolicLink(stats)) throw UV('EINVAL', 'readlink', path);
	const size = stats.size;
	const data = new Uint8Array(size);
	return decodeUTF8(data.subarray(0, fs.readSync(resolved, data, 0, size)));
}

export function mkdir(this: V_Context, path: PathLike, options: MkdirOptions = {}): string | void {
	const original = normalizePath.call(this, path);
	const $ex = { syscall: 'mkdir', path: original };

	const { fullPath: realParent } = resolve(this, dirname(original), false, $ex);
	const { fs, cache, path: target } = resolveMount(join(realParent, basename(original)), this, $ex);

	const followed = realParent != dirname(original);

	const { euid: uid, egid: gid } = contextOf(this).credentials;

	const { recursive } = options;
	const mode = applyUmask(this, options.mode ?? 0o777);

	let firstCreated: string | undefined;

	const __create = (path: string, resolved: string): InodeLike => {
		const parentPath = dirname(resolved);

		const parent = recursive && parentPath != '/' ? __create(dirname(path), parentPath) : cache.statSync(parentPath, $ex);

		if (recursive) {
			let existing: InodeLike | undefined;
			try {
				existing = cache.statSync(resolved);
			} catch {
				// It doesn't exist yet
			}

			if (existing) {
				const stats = isSymbolicLink(existing) ? resolve(this, path, false, $ex).stats : existing;

				if (!stats) throw UV('ENOENT', $ex);
				if (!isDirectory(stats)) throw UV(resolved == target ? 'EEXIST' : 'ENOTDIR', $ex);
				return existing;
			}

			if (followed && fs.existsSync(join(parentPath, basename(path)))) throw UV('ENOENT', $ex);
		}

		if (checkAccess && !hasAccess(this, parent, constants.W_OK | constants.X_OK)) throw UV('EACCES', 'mkdir', path);

		using _ = cache.lockSync(parentPath, 'rw', parent);

		const inode = wrap(fs, 'mkdirSync', { path, syscall: 'mkdir' })(resolved, {
			mode,
			uid: parent.mode & constants.S_ISUID ? parent.uid : uid,
			gid: parent.mode & constants.S_ISGID ? parent.gid : gid,
		});

		if (recursive) firstCreated ??= path;
		emitChange(this, 'rename', path);
		return inode;
	};

	__create(original, target);
	return firstCreated;
}

export function readdir(this: V_Context, path: PathLike, options: ReaddirOptions = {}): Dirent[] {
	path = normalizePath.call(this, path);

	const { fs, cache, path: resolved } = resolve(this, path);

	// Node reports `readdir` failures as `scandir`
	const stats = cache.statSync(resolved, { path, syscall: 'scandir' });
	if (checkAccess && !hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', 'scandir', path);

	if (!isDirectory(stats)) throw UV('ENOTDIR', 'scandir', path);

	let entries: string[];
	{
		using _ = cache.lockSync(resolved, 'ro', stats);
		entries = fs.readdirSync(resolved);
	}

	const values: Dirent[] = [];

	const addEntry = (entry: string) => {
		let entryStat: InodeLike;
		try {
			entryStat = cache.statSync(join(resolved, entry), { syscall: 'scandir', path });
		} catch (e: any) {
			if (e.code == 'ENOENT') return;
			throw e;
		}

		values.push({ ino: entryStat.ino, type: ifToDt(entryStat.mode), path: entry, name: basename(entry) });

		if (!isDirectory(entryStat) || !options?.recursive) return;

		const children = fs.readdirSync(join(resolved, entry));
		for (const child of children) addEntry(join(entry, child));
	};

	for (const entry of entries) addEntry(entry);

	return values;
}

export function rename(this: V_Context, oldPath: PathLike, newPath: PathLike): void {
	oldPath = normalizePath.call(this, oldPath);
	newPath = normalizePath.call(this, newPath);
	const $ex = { syscall: 'rename', path: oldPath, dest: newPath };
	const src = resolve(this, oldPath, true, $ex);
	const dst = resolve(this, newPath, true, $ex);

	if (src.fs.uuid !== dst.fs.uuid) throw UV('EXDEV', $ex);
	// A directory can not be moved inside itself
	if (dst.path.startsWith(src.path + '/')) throw UV('EINVAL', $ex);
	if (!src.stats) throw UV('ENOENT', $ex);

	const srcDir = dirname(src.path);
	const dstDir = dirname(dst.path);

	const oldParent = src.cache.statSync(srcDir, $ex);
	const newParent = src.cache.statSync(dstDir, $ex);

	let newStats: InodeLike | undefined;
	try {
		newStats = src.cache.statSync(dst.path, $ex);
	} catch (e: any) {
		if (e.code != 'ENOENT') throw e;
	}

	assertRemovable(this, oldParent, src.stats, $ex);
	if (newStats) assertRemovable(this, newParent, newStats, $ex);
	if (checkAccess && !hasAccess(this, newParent, constants.W_OK | constants.X_OK)) throw UV('EACCES', $ex);
	if (checkAccess && isDirectory(src.stats) && srcDir != dstDir && !hasAccess(this, src.stats, constants.W_OK)) throw UV('EACCES', $ex);

	if (newStats && !isDirectory(src.stats) && isDirectory(newStats)) throw UV('EISDIR', $ex);
	if (newStats && isDirectory(src.stats) && !isDirectory(newStats)) throw UV('ENOTDIR', $ex);

	// Lock both parent directories, ordered by inode number to avoid ABBA deadlocks (like Linux's `lock_two_nondirectories`)
	const parents: [string, InodeLike][] = [
		[srcDir, oldParent],
		[dstDir, newParent],
	];
	if (oldParent.ino > newParent.ino) parents.reverse();

	using _first = src.cache.lockSync(parents[0][0], 'rw', parents[0][1]);
	using _second = oldParent.ino == newParent.ino ? null : src.cache.lockSync(parents[1][0], 'rw', parents[1][1]);

	src.fs.renameSync(src.path, dst.path);
	src.cache.rename(src.path, dst.path);

	// Both names change which entries exist, so both are 'rename' events
	emitChange(this, 'rename', oldPath);
	emitChange(this, 'rename', newPath);
}

export function link(this: V_Context, target: PathLike, link: PathLike): void {
	target = normalizePath.call(this, target);
	link = normalizePath.call(this, link);

	const $ex = { syscall: 'link', path: target, dest: link };
	const { fs, cache, path: resolved } = resolve(this, target, true, $ex);
	const dst = resolve(this, link, true, $ex);

	if (fs.uuid !== dst.fs.uuid) throw UV('EXDEV', $ex);

	const stats = cache.statSync(resolved, $ex);

	if (checkAccess) {
		if (!hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', $ex);

		const dirStats = cache.statSync(dirname(resolved), $ex);
		if (!hasAccess(this, dirStats, constants.R_OK)) throw UV('EACCES', $ex);

		const destStats = cache.statSync(dirname(dst.path), $ex);
		if (!hasAccess(this, destStats, constants.W_OK)) throw UV('EACCES', $ex);
	}

	using _ = cache.lockSync(dirname(dst.path), 'rw');
	fs.linkSync(resolved, dst.path);
	cache.link(resolved, dst.path);
}

export function stat(this: V_Context, path: PathLike, lstat: boolean): InodeLike {
	path = normalizePath.call(this, path);

	const extra = { syscall: lstat ? 'lstat' : 'stat', path };

	let stats: InodeLike | undefined;
	if (!lstat) stats = resolve(this, path, false, extra).stats;
	else {
		const { base, dir } = parse(path);
		const parent = resolve(this, dir, false, extra);
		if (parent.stats && isDirectory(parent.stats)) assertSearchable(this, parent.stats, extra);
		const { root, mounts } = contextOf(this);
		const mounted = base && mounts.get(join(root, parent.fullPath, base));
		const fs = mounted || parent.fs;
		const target = mounted ? '/' : join(parent.path, base);
		try {
			stats = cacheOf(fs).statSync(target);
		} catch (e: any) {
			setUVMessage(Object.assign(e, extra));
			throw e;
		}
	}

	if (!stats) throw UV('ENOENT', extra);

	return stats;
}

/**
 * Opens a handle for changing metadata, which does not need read or write access to the file.
 */
function _openMetadata($: V_Context, path: string, syscall: string, noFollow?: boolean): Handle {
	const { fullPath, cache, path: resolved, stats } = resolve($, path, noFollow, { syscall });
	if (!stats) throw UV('ENOENT', syscall, path);
	return new Handle($, fullPath, resolved, constants.O_RDONLY, cache.ref(resolved, stats));
}

export function chmod(this: V_Context, path: PathLike, mode: Mode, noFollow?: boolean): void {
	path = normalizePath.call(this, path);
	const numMode = normalizeMode(mode, -1);
	if (numMode < 0) throw UV('EINVAL', 'chmod', path);
	using handle = _openMetadata(this, path, 'chmod', noFollow);
	handle.chmodSync(numMode);
	emitChange(this, 'change', handle.path);
}

export function chown(this: V_Context, path: PathLike, uid: number, gid: number, noFollow?: boolean): void {
	path = normalizePath.call(this, path);
	using handle = _openMetadata(this, path, 'chown', noFollow);
	handle.chownSync(uid, gid);
	emitChange(this, 'change', handle.path);
}

export function utimes(this: V_Context, path: PathLike, atime: TimeLike, mtime: TimeLike, noFollow?: boolean): void {
	path = normalizePath.call(this, path);
	using handle = _openMetadata(this, path, 'utimes', noFollow);
	handle.utimesSync(normalizeTime(atime), normalizeTime(mtime));
	emitChange(this, 'change', handle.path);
}
