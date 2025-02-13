// Utilities and shared data

import type * as fs from 'node:fs';
import type { File } from '../internal/file.js';
import type { FileSystem } from '../internal/filesystem.js';
import type { Stats } from '../stats.js';

import { InMemory } from '../backends/memory.js';
import { bindContext, type BoundContext, type V_Context } from '../context.js';
import { Errno, ErrnoError } from '../internal/error.js';
import { alert, debug, err, info, log_deprecated, notice, warn } from '../internal/log.js';
import { normalizePath } from '../utils.js';
import { size_max } from './constants.js';
import { join, resolve, type AbsolutePath } from './path.js';

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
 * @category Backends and Configuration
 * @internal
 */
export const mounts: Map<string, FileSystem> = new Map();

// Set a default root.
mount('/', InMemory.create({ name: 'root' }));

/**
 * Mounts the file system at `mountPoint`.
 * @category Backends and Configuration
 * @internal
 */
export function mount(mountPoint: string, fs: FileSystem): void {
	if (mountPoint[0] != '/') mountPoint = '/' + mountPoint;

	mountPoint = resolve(mountPoint);
	if (mounts.has(mountPoint)) {
		throw err(new ErrnoError(Errno.EINVAL, 'Mount point ' + mountPoint + ' is already in use'));
	}
	fs._mountPoint = mountPoint;
	mounts.set(mountPoint, fs);
	info(`Mounted ${fs.name} on ${mountPoint}`);
	debug(`${fs.name} attributes: ${[...fs.attributes].map(([k, v]) => (v !== undefined && v !== null ? k + '=' + v : v)).join(', ')}`);
}

/**
 * Unmounts the file system at `mountPoint`.
 * @category Backends and Configuration
 */
export function umount(mountPoint: string): void {
	if (mountPoint[0] != '/') mountPoint = '/' + mountPoint;

	mountPoint = resolve(mountPoint);
	if (!mounts.has(mountPoint)) {
		warn(mountPoint + ' is already unmounted');
		return;
	}

	mounts.delete(mountPoint);
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
	stats?: Stats;
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

/* node:coverage disable */
/**
 * @internal @deprecated
 */
export function mountObject(mounts: MountObject): void {
	log_deprecated('mountObject');
	if ('/' in mounts) {
		umount('/');
	}
	for (const [point, fs] of Object.entries(mounts)) {
		mount(point, fs);
	}
}
/* node:coverage enable */

/**
 * @internal @hidden
 */
export function _statfs<const T extends boolean>(fs: FileSystem, bigint?: T): T extends true ? fs.BigIntStatsFs : fs.StatsFs {
	const md = fs.usage();
	const bs = md.blockSize || 4096;

	return {
		type: (bigint ? BigInt : Number)(fs.id),
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
 * @param inPlace if true, this changes the root for the current context instead of creating a new one (if associated with a context).
 * @category Backends and Configuration
 */
export function chroot(this: V_Context, path: string, inPlace?: false): BoundContext;
export function chroot<T extends V_Context>(this: T, path: string, inPlace: true): T;
export function chroot<T extends V_Context>(this: T & V_Context, path: string, inPlace?: boolean): T | BoundContext {
	const creds = this?.credentials;
	if (creds?.uid && creds?.gid && creds?.euid && creds?.egid) {
		throw new ErrnoError(Errno.EPERM, 'Can not chroot() as non-root user');
	}
	if (inPlace && this) {
		this.root += path;
		return this;
	}
	return bindContext(join(this?.root || '/', path), creds);
}

/**
 * @internal @hidden
 */
function _isParentOf(parent: string, child: string): boolean {
	if (parent === '/' || parent === child) return true;

	if (!parent.endsWith('/')) parent += '/';

	return child.startsWith(parent);
}
