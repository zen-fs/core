// Utilities and shared data

import { resolve } from './path.js';
import { ApiError, ErrorCode } from '../ApiError.js';
import { Cred, rootCred } from '../cred.js';
import { FileSystem } from '../filesystem.js';
import { InMemory } from '../backends/InMemory.js';
import type { File } from '../file.js';
import type { EncodingOption, OpenMode, WriteFileOptions } from 'node:fs';

/**
 * converts Date or number to a integer UNIX timestamp
 * Grabbed from NodeJS sources (lib/fs.js)
 *
 * @internal
 */
export function _toUnixTimestamp(time: Date | number): number {
	if (typeof time === 'number') {
		return Math.floor(time);
	}
	if (time instanceof Date) {
		return Math.floor(time.getTime() / 1000);
	}
	throw new Error('Cannot parse time: ' + time);
}

/**
 * Normalizes a mode
 * @internal
 */
export function normalizeMode(mode: string | number | unknown, def?: number): number {
	if (typeof mode == 'number') {
		return mode;
	}

	if (typeof mode == 'string') {
		const parsed = parseInt(mode, 8);
		if (!isNaN(parsed)) {
			return parsed;
		}
	}

	if (typeof def == 'number') {
		return def;
	}

	throw new ApiError(ErrorCode.EINVAL, 'Invalid mode: ' + mode?.toString());
}

/**
 * Normalizes a time
 * @internal
 */
export function normalizeTime(time: string | number | Date): Date {
	if (time instanceof Date) {
		return time;
	}

	if (typeof time == 'number') {
		return new Date(time * 1000);
	}

	if (typeof time == 'string') {
		return new Date(time);
	}

	throw new ApiError(ErrorCode.EINVAL, 'Invalid time.');
}

/**
 * Normalizes a path
 * @internal
 */
export function normalizePath(p: string): string {
	// Node doesn't allow null characters in paths.
	if (p.includes('\x00')) {
		throw new ApiError(ErrorCode.EINVAL, 'Path must be a string without null bytes.');
	}
	if (p.length == 0) {
		throw new ApiError(ErrorCode.EINVAL, 'Path must not be empty.');
	}
	return resolve(p.replaceAll(/[/\\]+/g, '/'));
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
	options?: WriteFileOptions | (EncodingOption & { flag?: OpenMode }),
	encoding: BufferEncoding = 'utf8',
	flag?: string,
	mode: number = 0
): { encoding: BufferEncoding; flag: string; mode: number } {
	if (typeof options != 'object' || options === null) {
		return {
			encoding: typeof options == 'string' ? options : encoding,
			flag,
			mode,
		};
	}

	return {
		encoding: typeof options?.encoding == 'string' ? options.encoding : encoding,
		flag: typeof options?.flag == 'string' ? options.flag : flag,
		mode: normalizeMode('mode' in options ? options?.mode : null, mode),
	};
}

/**
 * Do nothing
 * @internal
 */
export function nop() {
	// do nothing
}

// credentials
export let cred: Cred = rootCred;
export function setCred(val: Cred): void {
	cred = val;
}

// descriptors
export const fdMap: Map<number, File> = new Map();
let nextFd = 100;
export function getFdForFile(file: File): number {
	const fd = nextFd++;
	fdMap.set(fd, file);
	return fd;
}
export function fd2file(fd: number): File {
	if (!fdMap.has(fd)) {
		throw new ApiError(ErrorCode.EBADF);
	}
	return fdMap.get(fd);
}

// mounting
export interface MountMapping {
	[point: string]: FileSystem;
}

/**
 * The map of mount points
 * @internal
 */
export const mounts: Map<string, FileSystem> = new Map();

/*
Set a default root.
*/
mount('/', InMemory.create({ name: 'root' }));

/**
 * Mounts the file system at the given mount point.
 */
export function mount(mountPoint: string, fs: FileSystem): void {
	if (mountPoint[0] !== '/') {
		mountPoint = '/' + mountPoint;
	}
	mountPoint = resolve(mountPoint);
	if (mounts.has(mountPoint)) {
		throw new ApiError(ErrorCode.EINVAL, 'Mount point ' + mountPoint + ' is already in use.');
	}
	mounts.set(mountPoint, fs);
}

/**
 * Unmounts the file system at the given mount point.
 */
export function umount(mountPoint: string): void {
	if (mountPoint[0] !== '/') {
		mountPoint = `/${mountPoint}`;
	}
	mountPoint = resolve(mountPoint);
	if (!mounts.has(mountPoint)) {
		throw new ApiError(ErrorCode.EINVAL, 'Mount point ' + mountPoint + ' is already unmounted.');
	}
	mounts.delete(mountPoint);
}

/**
 * Gets the internal FileSystem for the path, then returns it along with the path relative to the FS' root
 */
export function resolveMount(path: string): { fs: FileSystem; path: string; mountPoint: string } {
	path = normalizePath(path);
	const sortedMounts = [...mounts].sort((a, b) => (a[0].length > b[0].length ? -1 : 1)); // decending order of the string length
	for (const [mountPoint, fs] of sortedMounts) {
		// We know path is normalized, so it would be a substring of the mount point.
		if (mountPoint.length <= path.length && path.startsWith(mountPoint)) {
			path = path.slice(mountPoint.length > 1 ? mountPoint.length : 0); // Resolve the path relative to the mount point
			if (path === '') {
				path = '/';
			}
			return { fs, path, mountPoint };
		}
	}

	throw new ApiError(ErrorCode.EIO, 'ZenFS not initialized with a file system');
}

/**
 * Reverse maps the paths in text from the mounted FileSystem to the global path
 */
export function fixPaths(text: string, paths: { [from: string]: string }): string {
	for (const [from, to] of Object.entries(paths)) {
		text = text?.replaceAll(from, to);
	}
	return text;
}

export function fixError<E extends Error>(e: E, paths: { [from: string]: string }): E {
	if (typeof e.stack == 'string') {
		e.stack = fixPaths(e.stack, paths);
	}
	e.message = fixPaths(e.message, paths);
	return e;
}

export function mountMapping(mountMapping: MountMapping): void {
	if ('/' in mountMapping) {
		umount('/');
	}
	for (const [point, fs] of Object.entries(mountMapping)) {
		mount(point, fs);
	}
}

/**
 * Types supports as path parameters.
 *
 * In the future, maybe support URL?
 */
export type PathLike = string;
