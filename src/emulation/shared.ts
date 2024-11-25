// Utilities and shared data

import type { BigIntStatsFs, StatsFs } from 'node:fs';
import { InMemory } from '../backends/memory.js';
import { Errno, ErrnoError } from '../error.js';
import type { File } from '../file.js';
import type { FileSystem } from '../filesystem.js';
import { normalizePath } from '../utils.js';
import { join, resolve, type AbsolutePath } from './path.js';
import { size_max } from './constants.js';
import { bindContext, type BoundContext, type V_Context } from '../context.js';
import { paths as pathCache } from './cache.js';

// descriptors

/**
 * @internal @hidden
 */
export const fdMap: Map<number, File> = new Map();
let nextFd = 100;

/**
 * @internal @hidden
 */
export function file2fd(file: File): number {
	const fd = nextFd++;
	fdMap.set(fd, file);
	return fd;
}

/**
 * @internal @hidden
 */
export function fd2file(fd: number): File {
	if (!fdMap.has(fd)) {
		throw new ErrnoError(Errno.EBADF);
	}
	return fdMap.get(fd)!;
}

/**
 * @internal @hidden
 */
export type MountObject = Record<AbsolutePath, FileSystem>;

/**
 * The map of mount points
 * @internal
 */
export const mounts: Map<string, FileSystem> = new Map();

// Set a default root.
mount('/', InMemory.create({ name: 'root' }));

/**
 * Mounts the file system at `mountPoint`.
 * @internal
 */
export function mount(mountPoint: string, fs: FileSystem): void {
	if (mountPoint[0] !== '/') {
		mountPoint = '/' + mountPoint;
	}
	mountPoint = resolve(mountPoint);
	if (mounts.has(mountPoint)) {
		throw new ErrnoError(Errno.EINVAL, 'Mount point ' + mountPoint + ' is already in use.');
	}
	mounts.set(mountPoint, fs);
	pathCache.clear();
}

/**
 * Unmounts the file system at `mountPoint`.
 */
export function umount(mountPoint: string): void {
	if (mountPoint[0] !== '/') {
		mountPoint = '/' + mountPoint;
	}
	mountPoint = resolve(mountPoint);
	if (!mounts.has(mountPoint)) {
		throw new ErrnoError(Errno.EINVAL, 'Mount point ' + mountPoint + ' is already unmounted.');
	}
	mounts.delete(mountPoint);
	pathCache.clear();
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
 * Gets the internal `FileSystem` for the path, then returns it along with the path relative to the FS' root
 * @internal @hidden
 */
export function resolveMount(path: string, ctx: V_Context): ResolvedMount {
	const root = ctx?.root || '/';
	path = normalizePath(join(root, path));
	const sortedMounts = [...mounts].sort((a, b) => (a[0].length > b[0].length ? -1 : 1)); // descending order of the string length
	for (const [mountPoint, fs] of sortedMounts) {
		// We know path is normalized, so it would be a substring of the mount point.
		if (mountPoint.length <= path.length && path.startsWith(mountPoint)) {
			path = path.slice(mountPoint.length > 1 ? mountPoint.length : 0); // Resolve the path relative to the mount point
			if (path === '') {
				path = root;
			}
			return { fs, path, mountPoint, root };
		}
	}

	throw new ErrnoError(Errno.EIO, 'No file system');
}

/**
 * Wait for all file systems to be ready and synced.
 * May be removed at some point.
 * @experimental @internal
 */
export async function _synced(): Promise<void> {
	await Promise.all([...mounts.values()].map(m => m.ready()));
	return;
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
 * @internal @deprecated
 */
export function mountObject(mounts: MountObject): void {
	if ('/' in mounts) {
		umount('/');
	}
	for (const [point, fs] of Object.entries(mounts)) {
		mount(point, fs);
	}
}

/**
 * @internal @hidden
 */
export function _statfs<const T extends boolean>(fs: FileSystem, bigint?: T): T extends true ? BigIntStatsFs : StatsFs {
	const md = fs.metadata();
	const bs = md.blockSize || 4096;

	return {
		type: (bigint ? BigInt : Number)(md.type),
		bsize: (bigint ? BigInt : Number)(bs),
		ffree: (bigint ? BigInt : Number)(md.freeNodes || size_max),
		files: (bigint ? BigInt : Number)(md.totalNodes || size_max),
		bavail: (bigint ? BigInt : Number)(md.freeSpace / bs),
		bfree: (bigint ? BigInt : Number)(md.freeSpace / bs),
		blocks: (bigint ? BigInt : Number)(md.totalSpace / bs),
	} as T extends true ? BigIntStatsFs : StatsFs;
}

/**
 * Options used for caching, among other things.
 * @internal @hidden *UNSTABLE*
 */
export interface InternalOptions {
	/**
	 * If true, then this readdir was called from another function.
	 * In this case, don't clear the cache when done.
	 * @internal *UNSTABLE*
	 */
	_isIndirect?: boolean;
}

export interface ReaddirOptions extends InternalOptions {
	withFileTypes?: boolean;
	recursive?: boolean;
}

/**
 * Change
 * @experimental
 */
export function chroot(this: V_Context, path: string): BoundContext {
	return bindContext(join(this?.root || '/', path));
}
