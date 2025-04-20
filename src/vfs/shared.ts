// Utilities and shared data

import type * as fs from 'node:fs';
import type { FileSystem } from '../internal/filesystem.js';

import { InMemory } from '../backends/memory.js';
import type { V_Context } from '../context.js';
import { defaultContext } from '../internal/contexts.js';
import { Errno, ErrnoError } from '../internal/error.js';
import type { InodeLike } from '../internal/inode.js';
import { alert, debug, err, info, notice, warn } from '../internal/log.js';
import { join, resolve, type AbsolutePath } from '../path.js';
import { normalizePath } from '../utils.js';
import { size_max } from './constants.js';

/**
 * @internal @hidden
 */
export type MountObject = Record<AbsolutePath, FileSystem>;

/**
 * The map of mount points
 * @category Backends and Configuration
 * @internal
 */
export const mounts: Map<string, FileSystem> = new Map();

// Set a default root.
mount('/', InMemory.create({ label: 'root' }));

/**
 * Mounts the file system at `mountPoint`.
 * @category Backends and Configuration
 * @internal
 */
export function mount(this: V_Context, mountPoint: string, fs: FileSystem): void {
	if (mountPoint[0] != '/') mountPoint = '/' + mountPoint;
    
    const mts = this?.mounts || mounts
	mountPoint = resolve.call(this, mountPoint);
	if (mts.has(mountPoint)) throw err(new ErrnoError(Errno.EINVAL, 'Mount point is already in use: ' + mountPoint));

	fs._mountPoint = mountPoint;
	mts.set(mountPoint, fs);
	info(`Mounted ${fs.name} on ${mountPoint}`);
	debug(`${fs.name} attributes: ${[...fs.attributes].map(([k, v]) => (v !== undefined && v !== null ? k + '=' + v : k)).join(', ')}`);
}

/**
 * Unmounts the file system at `mountPoint`.
 * @category Backends and Configuration
 */
export function umount(this: V_Context, mountPoint: string): void {
	if (mountPoint[0] != '/') mountPoint = '/' + mountPoint;
    const mts = this?.mounts || mounts
	mountPoint = resolve.call(this, mountPoint);
	if (!mts.has(mountPoint)) {
		warn(mountPoint + ' is already unmounted');
		return;
	}

	mts.delete(mountPoint);
	notice('Unmounted ' + mountPoint);
}

/**
 * @internal @hidden
 */
export interface ResolvedMount {
	fs: FileSystem;
	path: string;
	mountPoint: string;
	root: string;
}

/**
 * @internal @hidden
 */
export interface ResolvedPath extends ResolvedMount {
	/** The real, absolute path */
	fullPath: string;
	/** Stats */
	stats?: InodeLike;
}

/**
 * Gets the internal `FileSystem` for the path, then returns it along with the path relative to the FS' root
 * @internal @hidden
 */
export function resolveMount(path: string, ctx: V_Context): ResolvedMount {
	const root = ctx?.root || defaultContext.root;
    const mts = ctx?.mounts || mounts
	path = normalizePath(join(root, path));
	const sortedMounts = [...mts].sort((a, b) => (a[0].length > b[0].length ? -1 : 1)); // descending order of the string length
	for (const [mountPoint, fs] of sortedMounts) {
		// We know path is normalized, so it would be a substring of the mount point.
		if (_isParentOf(mountPoint, path)) {
			path = path.slice(mountPoint.length > 1 ? mountPoint.length : 0); // Resolve the path relative to the mount point
			if (path === '') path = root;
			return { fs, path, mountPoint, root };
		}
	}

	throw alert(new ErrnoError(Errno.EIO, 'No file system', path));
}

/**
 * Reverse maps the paths in text from the mounted FileSystem to the global path
 * @internal @hidden
 */
export function fixPaths(text: string, paths: Record<string, string>): string {
	for (const [from, to] of Object.entries(paths)) {
		text = text?.replaceAll(from, to);
	}
	return text;
}

/**
 * Fix paths in error stacks
 * @internal @hidden
 */
export function fixError<E extends ErrnoError>(e: E, paths: Record<string, string>): E {
	if (typeof e.stack == 'string') {
		e.stack = fixPaths(e.stack, paths);
	}
	try {
		e.message = fixPaths(e.message, paths);
	} catch {
		// `message` is read only
	}
	if (e.path) e.path = fixPaths(e.path, paths);
	return e;
}

/**
 * @internal @hidden
 */
export function _statfs<const T extends boolean>(fs: FileSystem, bigint?: T): T extends true ? fs.BigIntStatsFs : fs.StatsFs {
	const md = fs.usage();
	const bs = md.blockSize || 4096;

	return {
		type: (bigint ? BigInt : Number)(fs.type),
		bsize: (bigint ? BigInt : Number)(bs),
		ffree: (bigint ? BigInt : Number)(md.freeNodes || size_max),
		files: (bigint ? BigInt : Number)(md.totalNodes || size_max),
		bavail: (bigint ? BigInt : Number)(md.freeSpace / bs),
		bfree: (bigint ? BigInt : Number)(md.freeSpace / bs),
		blocks: (bigint ? BigInt : Number)(md.totalSpace / bs),
	} as T extends true ? fs.BigIntStatsFs : fs.StatsFs;
}

/**
 * Change the root path
 * @category Backends and Configuration
 */
export function chroot(this: V_Context, path: string) {
	const $ = this ?? defaultContext;
	if ($.credentials?.uid !== 0 && $.credentials?.gid !== 0 && $.credentials?.euid !== 0 && $.credentials?.egid !== 0)
		throw new ErrnoError(Errno.EPERM, 'Can not chroot() as non-root user');

	$.root ??= '/';

	const newRoot = join($.root, path);

	for (const handle of $.descriptors?.values() ?? []) {
		if (!handle.path.startsWith($.root)) throw ErrnoError.With('EBUSY', handle.path, 'chroot');
		(handle as any).path = handle.path.slice($.root.length);
	}

	if (newRoot.length > $.root.length) throw new ErrnoError(Errno.EPERM, 'Can not chroot() outside of current root');

	$.root = newRoot;
}

/**
 * @internal @hidden
 */
function _isParentOf(parent: string, child: string): boolean {
	if (parent === '/' || parent === child) return true;

	if (!parent.endsWith('/')) parent += '/';

	return child.startsWith(parent);
}
