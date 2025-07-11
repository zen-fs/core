// Utilities and shared data

import type * as fs from 'node:fs';
import type { V_Context } from '../context.js';
import type { FileSystem } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import type { FSContext } from '../internal/contexts.js';

import { getContext } from '../internal/contexts.js';
import { Errno, Exception, UV, withErrno } from 'kerium';
import { alert, debug, err, info, notice, warn } from 'kerium/log';
import { join, resolve, type AbsolutePath } from '../path.js';
import { normalizePath } from '../utils.js';
import { size_max } from './constants.js';
import { credentialsAllowRoot } from '../internal/credentials.js';

/**
 * @internal @hidden
 */
export type MountObject = Record<AbsolutePath, FileSystem>;

/**
 * Mounts the file system at `mountPoint`.
 * @category Backends and Configuration
 * @internal
 */
export function mount(this: V_Context, mountPoint: string, fs: FileSystem): void {
	if (mountPoint[0] != '/') mountPoint = '/' + mountPoint;
    const $$: FSContext = getContext(this);

	mountPoint = resolve.call($$, mountPoint);
	if ($$.mounts.has(mountPoint)) throw err(withErrno('EINVAL', 'Mount point is already in use: ' + mountPoint));

	fs._mountPoint = mountPoint;
	$$.mounts.set(mountPoint, fs);
	info(`Mounted ${fs.name} on ${mountPoint}`);
	debug(`${fs.name} attributes: ${[...fs.attributes].map(([k, v]) => (v !== undefined && v !== null ? k + '=' + v : k)).join(', ')}`);
}

/**
 * Unmounts the file system at `mountPoint`.
 * @category Backends and Configuration
 */
export function umount(this: V_Context, mountPoint: string): void {
	const $$: FSContext = getContext(this);
	if (mountPoint[0] != '/') mountPoint = '/' + mountPoint;
	mountPoint = resolve.call($$, mountPoint);
	if (!$$.mounts.has(mountPoint)) {
		warn(mountPoint + ' is already unmounted');
		return;
	}

	$$.mounts.delete(mountPoint);
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
export function resolveMount(path: string, $: V_Context): ResolvedMount {
	const $$: FSContext = getContext($);
	path = normalizePath.call($$, join($$.root, path));
	const sortedMounts = [...$$.mounts].sort((a, b) => (a[0].length > b[0].length ? -1 : 1)); // descending order of the string length
	for (const [mountPoint, fs] of sortedMounts) {
		// We know path is normalized, so it would be a substring of the mount point.
		if (!_isParentOf(mountPoint, path)) continue;
		path = path.slice(mountPoint.length > 1 ? mountPoint.length : 0); // Resolve the path relative to the mount point
		if (path === '') path = '/';
		const case_fold = fs.attributes.get('case_fold');
		if (case_fold === 'lower') path = path.toLowerCase();
		if (case_fold === 'upper') path = path.toUpperCase();

		return { fs, path, mountPoint, root: $$.root };
	}

	throw alert(new Exception(Errno.EIO, 'No file system for ' + path));
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
	const $$: FSContext = getContext(this);
	if (!credentialsAllowRoot($$.credentials)) throw withErrno('EPERM', 'Can not chroot() as non-root user');

	$$.root ??= '/';

	const newRoot = join($$.root, path);

	for (const handle of $$.descriptors?.values() ?? []) {
		if (!handle.path.startsWith($$.root)) throw UV('EBUSY', 'chroot', handle.path);
		(handle as any).path = handle.path.slice($$.root.length);
	}

	if (newRoot.length > $$.root.length) throw withErrno('EPERM', 'Can not chroot() outside of current root');

	$$.root = newRoot;
}

/**
 * @internal @hidden
 */
function _isParentOf(parent: string, child: string): boolean {
	if (parent === '/' || parent === child) return true;

	if (!parent.endsWith('/')) parent += '/';

	return child.startsWith(parent);
}
