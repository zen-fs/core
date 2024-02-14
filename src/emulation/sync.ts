import { ApiError, ErrorCode } from '../ApiError.js';
import { File, FileFlag } from '../file.js';
import { FileContents, FileSystem } from '../filesystem.js';
import { BigIntStats, Stats } from '../stats.js';
import type { symlink, ReadSyncOptions, StatOptions, BaseEncodingOptions, BufferEncodingOption } from 'fs';
import type * as Node from 'fs';
import {
	normalizePath,
	cred,
	getFdForFile,
	normalizeMode,
	normalizeOptions,
	fdMap,
	fd2file,
	normalizeTime,
	resolveFS,
	fixError,
	mounts,
	BufferToUint8Array,
	PathLike,
} from './shared.js';
import { decode, encode } from '../utils.js';
import { Dir, Dirent } from './dir.js';
import { join } from './path.js';

type FileSystemMethod = {
	[K in keyof FileSystem]: FileSystem[K] extends (...args: any) => any
		? (name: K, resolveSymlinks: boolean, ...args: Parameters<FileSystem[K]>) => ReturnType<FileSystem[K]>
		: never;
}[keyof FileSystem]; // https://stackoverflow.com/a/76335220/17637456

function doOp<M extends FileSystemMethod, RT extends ReturnType<M>>(...[name, resolveSymlinks, path, ...args]: Parameters<M>): RT {
	path = normalizePath(path);
	const { fs, path: resolvedPath } = resolveFS(resolveSymlinks && existsSync(path) ? realpathSync(path) : path);
	try {
		// @ts-expect-error 2556 (since ...args is not correctly picked up as being a tuple)
		return fs[name](resolvedPath, ...args) as RT;
	} catch (e) {
		throw fixError(e, { [resolvedPath]: path });
	}
}

/**
 * Synchronous rename.
 * @param oldPath
 * @param newPath
 */
export function renameSync(oldPath: PathLike, newPath: PathLike): void {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const _old = resolveFS(oldPath);
	const _new = resolveFS(newPath);
	const paths = { [_old.path]: oldPath, [_new.path]: newPath };
	try {
		if (_old === _new) {
			return _old.fs.renameSync(_old.path, _new.path, cred);
		}

		const data = readFileSync(oldPath);
		writeFileSync(newPath, data);
		unlinkSync(oldPath);
	} catch (e) {
		throw fixError(e, paths);
	}
}
renameSync satisfies typeof Node.renameSync;

/**
 * Test whether or not the given path exists by checking with the file system.
 * @param path
 */
export function existsSync(path: PathLike): boolean {
	path = normalizePath(path);
	try {
		const { fs, path: resolvedPath } = resolveFS(path);
		return fs.existsSync(resolvedPath, cred);
	} catch (e) {
		if ((e as ApiError).errno == ErrorCode.ENOENT) {
			return false;
		}

		throw e;
	}
}
existsSync satisfies typeof Node.existsSync;

/**
 * Synchronous `stat`.
 * @param path
 * @returns Stats
 */
export function statSync(path: PathLike, options?: { bigint: false }): Stats;
export function statSync(path: PathLike, options: { bigint: true }): BigIntStats;
export function statSync(path: PathLike, options?: StatOptions): Stats | BigIntStats {
	const _stats: Stats = doOp('statSync', true, path, cred);
	let stats: Stats | BigIntStats = _stats;
	if (options?.bigint) {
		stats = BigIntStats.clone(stats);
	}
	return stats;
}
statSync satisfies typeof Node.statSync;

/**
 * Synchronous `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 */
export function lstatSync(path: PathLike, options?: { bigint: false }): Stats;
export function lstatSync(path: PathLike, options: { bigint: true }): BigIntStats;
export function lstatSync(path: PathLike, options?: StatOptions): Stats | BigIntStats {
	const _stats: Stats = doOp('statSync', false, path, cred);
	let stats: Stats | BigIntStats = _stats;
	if (options?.bigint) {
		stats = BigIntStats.clone(stats);
	}
	return stats;
}
lstatSync satisfies typeof Node.lstatSync;

/**
 * Synchronous `truncate`.
 * @param path
 * @param len
 */
export function truncateSync(path: PathLike, len: number = 0): void {
	if (len < 0) {
		throw new ApiError(ErrorCode.EINVAL);
	}
	return doOp('truncateSync', true, path, len, cred);
}
truncateSync satisfies typeof Node.truncateSync;

/**
 * Synchronous `unlink`.
 * @param path
 */
export function unlinkSync(path: PathLike): void {
	return doOp('unlinkSync', false, path, cred);
}
unlinkSync satisfies typeof Node.unlinkSync;

/**
 * Synchronous file open.
 * @see http://www.manpagez.com/man/2/open/
 * @param path
 * @param flags
 * @param mode defaults to `0644`
 * @returns file descriptor
 */
export function openSync(path: PathLike, flag: string, mode: number | string = 0o644): number {
	const file: File = doOp('openSync', true, path, FileFlag.getFileFlag(flag), normalizeMode(mode, 0o644), cred);
	return getFdForFile(file);
}
openSync satisfies typeof Node.openSync;

/**
 * Synchronously reads the entire contents of a file.
 * @param filename
 * @param options
 * @option options encoding The string encoding for the file contents. Defaults to `null`.
 * @option options flag Defaults to `'r'`.
 * @returns file contents
 */
export function readFileSync(filename: string, options?: { flag?: string }): Uint8Array;
export function readFileSync(filename: string, options: { encoding: string; flag?: string }): string;
export function readFileSync(filename: string, encoding: string): string;
export function readFileSync(filename: string, arg2: { encoding: string; flag?: string } | { flag?: string } | string = {}): FileContents {
	const options = normalizeOptions(arg2, null, 'r', null);
	const flag = FileFlag.getFileFlag(options.flag);
	if (!flag.isReadable()) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to readFile must allow for reading.');
	}
	const data: Uint8Array = doOp('readFileSync', true, filename, flag, cred);
	switch (options.encoding) {
		case 'utf8':
		case 'utf-8':
			return decode(data);
		default:
			return data;
	}
}
readFileSync satisfies BufferToUint8Array<typeof Node.readFileSync>;

/**
 * Synchronously writes data to a file, replacing the file if it already
 * exists.
 *
 * The encoding option is ignored if data is a buffer.
 * @param filename
 * @param data
 * @param options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'w'`.
 */
export function writeFileSync(filename: string, data: FileContents, options?: Node.WriteFileOptions): void;
export function writeFileSync(filename: string, data: FileContents, encoding?: string): void;
export function writeFileSync(filename: string, data: FileContents, arg3?: Node.WriteFileOptions | string): void {
	const options = normalizeOptions(arg3, 'utf8', 'w', 0o644);
	const flag = FileFlag.getFileFlag(options.flag);
	if (!flag.isWriteable()) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to writeFile must allow for writing.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? encode(data) : data;
	return doOp('writeFileSync', true, filename, encodedData, flag, options.mode, cred);
}
writeFileSync satisfies typeof Node.writeFileSync;

/**
 * Asynchronously append data to a file, creating the file if it not yet
 * exists.
 *
 * @example Usage example
 *   fs.appendFile('message.txt', 'data to append', function (err) {
 *     if (err) throw err;
 *     console.log('The "data to append" was appended to file!');
 *   });
 * @param filename
 * @param data
 * @param options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'a'`.
 */
export function appendFileSync(filename: string, data: FileContents, options?: Node.WriteFileOptions): void;
export function appendFileSync(filename: string, data: FileContents, encoding?: string): void;
export function appendFileSync(filename: string, data: FileContents, arg3?: Node.WriteFileOptions | string): void {
	const options = normalizeOptions(arg3, 'utf8', 'a', 0o644);
	const flag = FileFlag.getFileFlag(options.flag);
	if (!flag.isAppendable()) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? encode(data) : data;
	return doOp('appendFileSync', true, filename, encodedData, flag, options.mode, cred);
}
appendFileSync satisfies typeof Node.appendFileSync;

/**
 * Synchronous `fstat`.
 * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
 * specified by the file descriptor `fd`.
 * @param fd
 */
export function fstatSync(fd: number, options?: { bigint?: false }): Stats;
export function fstatSync(fd: number, options: { bigint: true }): BigIntStats;
export function fstatSync(fd: number, options?: StatOptions): Stats | BigIntStats {
	const _stats: Stats = fd2file(fd).statSync();
	let stats: Stats | BigIntStats = _stats;
	if (options?.bigint) {
		stats = BigIntStats.clone(stats);
	}
	return stats;
}
fstatSync satisfies typeof Node.fstatSync;

/**
 * Synchronous close.
 * @param fd
 */
export function closeSync(fd: number): void {
	fd2file(fd).closeSync();
	fdMap.delete(fd);
}
closeSync satisfies typeof Node.closeSync;

/**
 * Synchronous ftruncate.
 * @param fd
 * @param len
 */
export function ftruncateSync(fd: number, len: number = 0): void {
	const file = fd2file(fd);
	if (len < 0) {
		throw new ApiError(ErrorCode.EINVAL);
	}
	file.truncateSync(len);
}
ftruncateSync satisfies typeof Node.ftruncateSync;

/**
 * Synchronous fsync.
 * @param fd
 */
export function fsyncSync(fd: number): void {
	fd2file(fd).syncSync();
}
fsyncSync satisfies typeof Node.fsyncSync;

/**
 * Synchronous fdatasync.
 * @param fd
 */
export function fdatasyncSync(fd: number): void {
	fd2file(fd).datasyncSync();
}
fdatasyncSync satisfies typeof Node.fdatasyncSync;

/**
 * Write buffer to the file specified by `fd`.
 * Note that it is unsafe to use fs.write multiple times on the same file
 * without waiting for it to return.
 * @param fd
 * @param buffer Uint8Array containing the data to write to
 *   the file.
 * @param offset Offset in the buffer to start reading data from.
 * @param length The amount of bytes to write to the file.
 * @param position Offset from the beginning of the file where this
 *   data should be written. If position is null, the data will be written at
 *   the current position.
 */
export function writeSync(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number | null): number;
export function writeSync(fd: number, data: string, position?: number | null, encoding?: BufferEncoding): number;
export function writeSync(fd: number, arg2: Uint8Array | string, arg3?: number, arg4?: BufferEncoding | number, arg5?: number): number {
	let buffer: Uint8Array,
		offset: number = 0,
		length: number,
		position: number | null;
	if (typeof arg2 === 'string') {
		// Signature 1: (fd, string, [position?, [encoding?]])
		position = typeof arg3 === 'number' ? arg3 : null;
		const encoding = (typeof arg4 === 'string' ? arg4 : 'utf8') as BufferEncoding;
		offset = 0;
		buffer = encode(arg2);
		length = buffer.length;
	} else {
		// Signature 2: (fd, buffer, offset, length, position?)
		buffer = arg2;
		offset = arg3;
		length = arg4 as number;
		position = typeof arg5 === 'number' ? arg5 : null;
	}

	const file = fd2file(fd);
	if (position === undefined || position === null) {
		position = file.getPos()!;
	}
	return file.writeSync(buffer, offset, length, position);
}
writeSync satisfies typeof Node.writeSync;

/**
 * Read data from the file specified by `fd`.
 * @param fd
 * @param buffer The buffer that the data will be
 *   written to.
 * @param offset The offset within the buffer where writing will
 *   start.
 * @param length An integer specifying the number of bytes to read.
 * @param position An integer specifying where to begin reading from
 *   in the file. If position is null, data will be read from the current file
 *   position.
 */
export function readSync(fd: number, buffer: Uint8Array, opts?: ReadSyncOptions): number;
export function readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number): number;
export function readSync(fd: number, buffer: Uint8Array, opts?: ReadSyncOptions | number, length?: number, position?: number): number {
	const file = fd2file(fd);
	let offset = opts as number;
	if (typeof opts == 'object') {
		({ offset, length, position } = opts);
	}

	if (isNaN(+position)) {
		position = file.getPos()!;
	}

	return file.readSync(buffer, offset, length, position);
}
readSync satisfies typeof Node.readSync;

/**
 * Synchronous `fchown`.
 * @param fd
 * @param uid
 * @param gid
 */
export function fchownSync(fd: number, uid: number, gid: number): void {
	fd2file(fd).chownSync(uid, gid);
}
fchownSync satisfies typeof Node.fchownSync;

/**
 * Synchronous `fchmod`.
 * @param fd
 * @param mode
 */
export function fchmodSync(fd: number, mode: number | string): void {
	const numMode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
	fd2file(fd).chmodSync(numMode);
}
fchmodSync satisfies typeof Node.fchmodSync;

/**
 * Change the file timestamps of a file referenced by the supplied file
 * descriptor.
 * @param fd
 * @param atime
 * @param mtime
 */
export function futimesSync(fd: number, atime: number | Date, mtime: number | Date): void {
	fd2file(fd).utimesSync(normalizeTime(atime), normalizeTime(mtime));
}
futimesSync satisfies typeof Node.futimesSync;

// DIRECTORY-ONLY METHODS

/**
 * Synchronous `rmdir`.
 * @param path
 */
export function rmdirSync(path: PathLike): void {
	return doOp('rmdirSync', true, path, cred);
}
rmdirSync satisfies typeof Node.rmdirSync;

/**
 * Synchronous `mkdir`.
 * @param path
 * @param mode defaults to o777
 * @todo Implement recursion
 */
export function mkdirSync(path: PathLike, options: Node.MakeDirectoryOptions & { recursive: true }): string;
export function mkdirSync(path: PathLike, options?: Node.Mode | (Node.MakeDirectoryOptions & { recursive?: false })): void;
export function mkdirSync(path: PathLike, options?: Node.Mode | Node.MakeDirectoryOptions): string | void {
	const mode: Node.Mode = typeof options == 'number' || typeof options == 'string' ? options : options?.mode;
	const recursive = typeof options == 'object' && options?.recursive;
	doOp('mkdirSync', true, path, normalizeMode(mode, 0o777), cred);
}
mkdirSync satisfies typeof Node.mkdirSync;

/**
 * Synchronous `readdir`. Reads the contents of a directory.
 * @param path
 */
export function readdirSync(path: PathLike, options: { encoding?: BufferEncoding; withFileTypes?: false } | BufferEncoding): string[];
export function readdirSync(path: PathLike, options: { encoding: 'buffer'; withFileTypes?: false } | 'buffer'): Uint8Array[];
export function readdirSync(path: PathLike, options: { withFileTypes: true }): Dirent[];
export function readdirSync(path: PathLike, options?: { encoding?: BufferEncoding | 'buffer'; withFileTypes?: boolean } | string): string[] | Dirent[] | Uint8Array[] {
	path = normalizePath(path);
	const entries: string[] = doOp('readdirSync', true, path, cred);
	for (const mount of mounts.keys()) {
		if (!mount.startsWith(path)) {
			continue;
		}
		const entry = mount.slice(path.length);
		if (entry.includes('/') || entry.length == 0) {
			// ignore FSs mounted in subdirectories and any FS mounted to `path`.
			continue;
		}
		entries.push(entry);
	}
	return <string[] | Dirent[] | Uint8Array[]>entries.map((entry: string) => {
		if (typeof options == 'object' && options?.withFileTypes) {
			return new Dirent(entry, statSync(join(path, entry)));
		}

		if (options == 'buffer' || (typeof options == 'object' && options.encoding == 'buffer')) {
			return encode(entry);
		}

		return entry;
	});
}
readdirSync satisfies BufferToUint8Array<typeof Node.readdirSync>;

// SYMLINK METHODS

/**
 * Synchronous `link`.
 * @param srcpath
 * @param dstpath
 */
export function linkSync(srcpath: PathLike, dstpath: PathLike): void {
	dstpath = normalizePath(dstpath);
	return doOp('linkSync', false, srcpath, dstpath, cred);
}
linkSync satisfies typeof Node.linkSync;

/**
 * Synchronous `symlink`.
 * @param srcpath
 * @param dstpath
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 */
export function symlinkSync(srcpath: PathLike, dstpath: PathLike, type?: symlink.Type): void {
	if (!['file', 'dir', 'junction'].includes(type)) {
		throw new ApiError(ErrorCode.EINVAL, 'Invalid type: ' + type);
	}
	dstpath = normalizePath(dstpath);
	return doOp('symlinkSync', false, srcpath, dstpath, type, cred);
}
symlinkSync satisfies typeof Node.symlinkSync;

/**
 * Synchronous readlink.
 * @param path
 */
export function readlinkSync(path: PathLike, options?: BufferEncodingOption): Uint8Array;
export function readlinkSync(path: PathLike, options: BaseEncodingOptions | BufferEncoding): string;
export function readlinkSync(path: PathLike, options?: BaseEncodingOptions | string | BufferEncodingOption): Uint8Array | string {
	const value: string = doOp('readlinkSync', false, path, cred);
	return encode(value, typeof options == 'object' ? options.encoding : options);
}
readlinkSync satisfies BufferToUint8Array<typeof Node.readlinkSync>;

// PROPERTY OPERATIONS

/**
 * Synchronous `chown`.
 * @param path
 * @param uid
 * @param gid
 */
export function chownSync(path: PathLike, uid: number, gid: number): void {
	doOp('chownSync', true, path, uid, gid, cred);
}
chownSync satisfies typeof Node.chownSync;

/**
 * Synchronous `lchown`.
 * @param path
 * @param uid
 * @param gid
 */
export function lchownSync(path: PathLike, uid: number, gid: number): void {
	doOp('chownSync', false, path, uid, gid, cred);
}
lchownSync satisfies typeof Node.lchownSync;

/**
 * Synchronous `chmod`.
 * @param path
 * @param mode
 */
export function chmodSync(path: PathLike, mode: string | number): void {
	const numMode = normalizeMode(mode, -1);
	if (numMode < 0) {
		throw new ApiError(ErrorCode.EINVAL, `Invalid mode.`);
	}
	doOp('chmodSync', true, path, numMode, cred);
}
chmodSync satisfies typeof Node.chmodSync;

/**
 * Synchronous `lchmod`.
 * @param path
 * @param mode
 */
export function lchmodSync(path: PathLike, mode: number | string): void {
	const numMode = normalizeMode(mode, -1);
	if (numMode < 1) {
		throw new ApiError(ErrorCode.EINVAL, `Invalid mode.`);
	}
	doOp('chmodSync', false, path, numMode, cred);
}
lchmodSync satisfies typeof Node.lchmodSync;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export function utimesSync(path: PathLike, atime: number | Date, mtime: number | Date): void {
	doOp('utimesSync', true, path, normalizeTime(atime), normalizeTime(mtime), cred);
}
utimesSync satisfies typeof Node.utimesSync;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export function lutimesSync(path: PathLike, atime: number | Date, mtime: number | Date): void {
	doOp('utimesSync', false, path, normalizeTime(atime), normalizeTime(mtime), cred);
}
lutimesSync satisfies typeof Node.lutimesSync;

/**
 * Synchronous `realpath`.
 * @param path
 * @param cache An object literal of mapped paths that can be used to
 *   force a specific path resolution or avoid additional `fs.stat` calls for
 *   known real paths.
 * @returns the real path
 */
export function realpathSync(path: PathLike, options: BufferEncodingOption): Uint8Array;
export function realpathSync(path: PathLike, options?: BaseEncodingOptions | BufferEncoding): string;
export function realpathSync(path: PathLike, options?: BaseEncodingOptions | BufferEncoding | BufferEncodingOption): string | Uint8Array {
	path = normalizePath(path);
	const { fs, path: resolvedPath, mountPoint } = resolveFS(path);
	try {
		const stats = fs.statSync(resolvedPath, cred);
		if (!stats.isSymbolicLink()) {
			return path;
		}
		const dst = normalizePath(mountPoint + fs.readlinkSync(resolvedPath, cred));
		return realpathSync(dst);
	} catch (e) {
		throw fixError(e, { [resolvedPath]: path });
	}
}
realpathSync satisfies BufferToUint8Array<typeof Node.realpathSync>;

/**
 * Synchronous `access`.
 * @param path
 * @param mode
 */
export function accessSync(path: PathLike, mode: number = 0o600): void {
	return doOp('accessSync', true, path, mode, cred);
}
accessSync satisfies typeof Node.accessSync;

export function rmSync(path: PathLike) {
	throw new ApiError(ErrorCode.ENOTSUP);
}
rmSync satisfies typeof Node.rmSync;

export function mkdtempSync(prefix: string, options: BufferEncodingOption): Uint8Array;
export function mkdtempSync(prefix: string, options?: BaseEncodingOptions | BufferEncoding): string;
export function mkdtempSync(prefix: string, options?: BaseEncodingOptions | BufferEncoding | BufferEncodingOption): string | Uint8Array {
	throw new ApiError(ErrorCode.ENOTSUP);
}
mkdtempSync satisfies BufferToUint8Array<typeof Node.mkdtempSync>;

export function copyFileSync(src: string, dest: string, flags?: number): void {
	throw new ApiError(ErrorCode.ENOTSUP);
}
copyFileSync satisfies typeof Node.copyFileSync;

export function readvSync(fd: number, buffers: readonly Uint8Array[], position?: number): number {
	throw new ApiError(ErrorCode.ENOTSUP);
}
readvSync satisfies typeof Node.readvSync;

export function writevSync(fd: number, buffers: readonly Uint8Array[], position?: number): number {
	throw new ApiError(ErrorCode.ENOTSUP);
}
writevSync satisfies typeof Node.writevSync;

export function opendirSync(path: PathLike, options?: Node.OpenDirOptions): Dir {
	throw new ApiError(ErrorCode.ENOTSUP);
}
opendirSync satisfies typeof Node.opendirSync;
