import { ApiError, ErrorCode } from '../ApiError.js';
import { ActionType, File, isAppendable, isReadable, isWriteable, parseFlag, pathExistsAction, pathNotExistsAction } from '../file.js';
import { FileContents, FileSystem } from '../filesystem.js';
import { BigIntStats, FileType, type BigIntStatsFs, type Stats, type StatsFs } from '../stats.js';
import type { symlink, ReadSyncOptions, StatOptions, EncodingOption, BufferEncodingOption } from 'fs';
import type * as Node from 'fs';
import { normalizePath, cred, getFdForFile, normalizeMode, normalizeOptions, fdMap, fd2file, normalizeTime, resolveFS, fixError, mounts, PathLike } from './shared.js';
import { Dir, Dirent } from './dir.js';
import { dirname, join } from './path.js';

type FileSystemMethod = {
	[K in keyof FileSystem]: FileSystem[K] extends (...args) => unknown
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

		writeFileSync(newPath, readFileSync(oldPath));
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
export function statSync(path: PathLike, options?: { bigint?: false }): Stats;
export function statSync(path: PathLike, options: { bigint: true }): BigIntStats;
export function statSync(path: PathLike, options?: StatOptions): Stats | BigIntStats {
	const stats: Stats = doOp('statSync', true, path, cred);
	return options?.bigint ? new BigIntStats(stats) : stats;
}
statSync satisfies typeof Node.statSync;

/**
 * Synchronous `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 */
export function lstatSync(path: PathLike, options?: { bigint?: false }): Stats;
export function lstatSync(path: PathLike, options: { bigint: true }): BigIntStats;
export function lstatSync(path: PathLike, options?: StatOptions): Stats | BigIntStats {
	const stats: Stats = doOp('statSync', false, path, cred);
	return options?.bigint ? new BigIntStats(stats) : stats;
}
lstatSync satisfies typeof Node.lstatSync;

/**
 * Synchronous `truncate`.
 * @param path
 * @param len
 */
export function truncateSync(path: PathLike, len: number = 0): void {
	const fd = openSync(path, 'r+');
	try {
		ftruncateSync(fd, len);
	} finally {
		closeSync(fd);
	}
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

function _openSync(_path: PathLike, _flag: string, _mode: Node.Mode, resolveSymlinks: boolean): File {
	const path = normalizePath(_path),
		mode = normalizeMode(_mode, 0o644),
		flag = parseFlag(_flag);
	// Check if the path exists, and is a file.
	let stats: Stats;
	try {
		stats = doOp('statSync', resolveSymlinks, path, cred);
	} catch (e) {
		// File does not exist.
		switch (pathNotExistsAction(flag)) {
			case ActionType.CREATE:
				// Ensure parent exists.
				const parentStats: Stats = doOp('statSync', resolveSymlinks, dirname(path), cred);
				if (!parentStats.isDirectory()) {
					throw ApiError.With('ENOTDIR', dirname(path), '_openSync');
				}
				return doOp('createFileSync', resolveSymlinks, path, flag, mode, cred);
			case ActionType.THROW:
				throw ApiError.With('ENOENT', path, '_openSync');
			default:
				throw new ApiError(ErrorCode.EINVAL, 'Invalid FileFlag object.');
		}
	}
	if (!stats.hasAccess(mode, cred)) {
		throw ApiError.With('EACCES', path, '_openSync');
	}

	// File exists.
	switch (pathExistsAction(flag)) {
		case ActionType.THROW:
			throw ApiError.With('EEXIST', path, '_openSync');
		case ActionType.TRUNCATE:
			// Delete file.
			doOp('unlinkSync', resolveSymlinks, path, cred);
			/*
				Create file. Use the same mode as the old file.
				Node itself modifies the ctime when this occurs, so this action
				will preserve that behavior if the underlying file system
				supports those properties.
			*/
			return doOp('createFileSync', resolveSymlinks, path, flag, stats.mode, cred);
		case ActionType.NOP:
			return doOp('openFileSync', resolveSymlinks, path, flag, cred);
		default:
			throw new ApiError(ErrorCode.EINVAL, 'Invalid FileFlag object.');
	}
}

/**
 * Synchronous file open.
 * @see http://www.manpagez.com/man/2/open/
 * @param flags Handles the complexity of the various file
 *   modes. See its API for more details.
 * @param mode Mode to use to open the file. Can be ignored if the
 *   filesystem doesn't support permissions.
 */
export function openSync(path: PathLike, flag: string, mode?: Node.Mode): number {
	return getFdForFile(_openSync(path, flag, mode, true));
}
openSync satisfies typeof Node.openSync;

/**
 * Opens a file or symlink
 * @internal
 */
export function lopenSync(path: PathLike, flag: string, mode?: Node.Mode): number {
	return getFdForFile(_openSync(path, flag, mode, false));
}

/**
 * Synchronously reads the entire contents of a file.
 */
function _readFileSync(fname: string, flag: string, resolveSymlinks: boolean): Uint8Array {
	// Get file.
	const file = _openSync(fname, flag, 0o644, resolveSymlinks);
	try {
		const stat = file.statSync();
		// Allocate buffer.
		const data = new Uint8Array(stat.size);
		file.readSync(data, 0, stat.size, 0);
		file.closeSync();
		return data;
	} finally {
		file.closeSync();
	}
}

/**
 * Synchronously reads the entire contents of a file.
 * @param filename
 * @param options
 * @option options encoding The string encoding for the file contents. Defaults to `null`.
 * @option options flag Defaults to `'r'`.
 * @returns file contents
 */
export function readFileSync(filename: string, options?: { flag?: string }): Buffer;
export function readFileSync(filename: string, options: (Node.EncodingOption & { flag?: string }) | BufferEncoding): string;
export function readFileSync(filename: string, arg2: Node.WriteFileOptions = {}): FileContents {
	const options = normalizeOptions(arg2, null, 'r', 0o644);
	const flag = parseFlag(options.flag);
	if (!isReadable(flag)) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to readFile must allow for reading.');
	}
	const data: Buffer = Buffer.from(_readFileSync(filename, options.flag, true));
	return options.encoding ? data.toString(options.encoding) : data;
}
readFileSync satisfies typeof Node.readFileSync;

/**
 * Synchronously writes data to a file, replacing the file
 * if it already exists.
 *
 * The encoding option is ignored if data is a buffer.
 */
function _writeFileSync(fname: string, data: Uint8Array, flag: string, mode: number, resolveSymlinks: boolean): void {
	const file = _openSync(fname, flag, mode, resolveSymlinks);
	try {
		file.writeSync(data, 0, data.length, 0);
	} finally {
		file.closeSync();
	}
}

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
export function writeFileSync(filename: string, data: FileContents, encoding?: BufferEncoding): void;
export function writeFileSync(filename: string, data: FileContents, _options?: Node.WriteFileOptions | BufferEncoding): void {
	const options = normalizeOptions(_options, 'utf8', 'w', 0o644);
	const flag = parseFlag(options.flag);
	if (!isWriteable(flag)) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to writeFile must allow for writing.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding) : data;
	if (encodedData === undefined) {
		throw new ApiError(ErrorCode.EINVAL, 'Data not specified');
	}
	_writeFileSync(filename, encodedData, options.flag, options.mode, true);
}
writeFileSync satisfies typeof Node.writeFileSync;

/**
 * Synchronously append data to a file, creating the file if
 * it not yet exists.
 */
function _appendFileSync(fname: string, data: Uint8Array, flag: string, mode: number, resolveSymlinks: boolean): void {
	const file = _openSync(fname, flag, mode, resolveSymlinks);
	try {
		file.writeSync(data, 0, data.length, null);
	} finally {
		file.closeSync();
	}
}

/**
 * Asynchronously append data to a file, creating the file if it not yet
 * exists.
 *
 * @param filename
 * @param data
 * @param options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'a'`.
 */
export function appendFileSync(filename: string, data: FileContents, _options?: Node.WriteFileOptions): void {
	const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
	const flag = parseFlag(options.flag);
	if (!isAppendable(flag)) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding) : data;
	_appendFileSync(filename, encodedData, options.flag, options.mode, true);
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
	const stats: Stats = fd2file(fd).statSync();
	return options?.bigint ? new BigIntStats(stats) : stats;
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
	if (len < 0) {
		throw new ApiError(ErrorCode.EINVAL);
	}
	fd2file(fd).truncateSync(len);
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
 * @param data Uint8Array containing the data to write to
 *   the file.
 * @param offset Offset in the buffer to start reading data from.
 * @param length The amount of bytes to write to the file.
 * @param position Offset from the beginning of the file where this
 *   data should be written. If position is null, the data will be written at
 *   the current position.
 */
export function writeSync(fd: number, data: Uint8Array, offset: number, length: number, position?: number): number;
export function writeSync(fd: number, data: string, position?: number, encoding?: BufferEncoding): number;
export function writeSync(fd: number, data: FileContents, posOrOff?: number, lenOrEnc?: BufferEncoding | number, pos?: number): number {
	let buffer: Uint8Array,
		offset: number = 0,
		length: number,
		position: number;
	if (typeof data === 'string') {
		// Signature 1: (fd, string, [position?, [encoding?]])
		position = typeof posOrOff === 'number' ? posOrOff : null;
		const encoding = <BufferEncoding>(typeof lenOrEnc === 'string' ? lenOrEnc : 'utf8');
		offset = 0;
		buffer = Buffer.from(data, encoding);
		length = buffer.length;
	} else {
		// Signature 2: (fd, buffer, offset, length, position?)
		buffer = data;
		offset = posOrOff;
		length = lenOrEnc as number;
		position = typeof pos === 'number' ? pos : null;
	}

	const file = fd2file(fd);
	if (position === undefined || position === null) {
		position = file.position!;
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
export function readSync(fd: number, buffer: Uint8Array, opts?: ReadSyncOptions | number, length?: number, position?: number | bigint): number {
	const file = fd2file(fd);
	const offset = typeof opts == 'object' ? opts.offset : opts;
	if (typeof opts == 'object') {
		length = opts.length;
		position = opts.position;
	}

	position = Number(position);
	if (isNaN(position)) {
		position = file.position!;
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
	const numMode = normalizeMode(mode, -1);
	if (numMode < 0) {
		throw new ApiError(ErrorCode.EINVAL, `Invalid mode.`);
	}
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
export function futimesSync(fd: number, atime: string | number | Date, mtime: string | number | Date): void {
	fd2file(fd).utimesSync(normalizeTime(atime), normalizeTime(mtime));
}
futimesSync satisfies typeof Node.futimesSync;

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
export function readdirSync(path: PathLike, options?: { encoding?: BufferEncoding; withFileTypes?: false } | BufferEncoding): string[];
export function readdirSync(path: PathLike, options: { encoding: 'buffer'; withFileTypes?: false } | 'buffer'): Buffer[];
export function readdirSync(path: PathLike, options: { withFileTypes: true }): Dirent[];
export function readdirSync(path: PathLike, options?: { encoding?: BufferEncoding | 'buffer'; withFileTypes?: boolean } | string): string[] | Dirent[] | Buffer[] {
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
	return <string[] | Dirent[] | Buffer[]>entries.map((entry: string): string | Dirent | Buffer => {
		if (typeof options == 'object' && options?.withFileTypes) {
			return new Dirent(entry, statSync(join(path, entry)));
		}

		if (options == 'buffer' || (typeof options == 'object' && options.encoding == 'buffer')) {
			return Buffer.from(entry);
		}

		return entry;
	});
}
readdirSync satisfies typeof Node.readdirSync;

// SYMLINK METHODS

/**
 * Synchronous `link`.
 * @param existing
 * @param newpath
 */
export function linkSync(existing: PathLike, newpath: PathLike): void {
	newpath = normalizePath(newpath);
	return doOp('linkSync', false, existing, newpath, cred);
}
linkSync satisfies typeof Node.linkSync;

/**
 * Synchronous `symlink`.
 * @param target target path
 * @param path link path
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 */
export function symlinkSync(target: PathLike, path: PathLike, type: symlink.Type = 'file'): void {
	if (!['file', 'dir', 'junction'].includes(type)) {
		throw new ApiError(ErrorCode.EINVAL, 'Invalid type: ' + type);
	}
	if (existsSync(path)) {
		throw ApiError.With('EEXIST', path, 'symlinkSync');
	}

	writeFileSync(path, target);
	const file = _openSync(path, 'r+', 0o644, false);
	file._setTypeSync(FileType.SYMLINK);
}
symlinkSync satisfies typeof Node.symlinkSync;

/**
 * Synchronous readlink.
 * @param path
 */
export function readlinkSync(path: PathLike, options?: BufferEncodingOption): Buffer;
export function readlinkSync(path: PathLike, options: EncodingOption | BufferEncoding): string;
export function readlinkSync(path: PathLike, options?: EncodingOption | BufferEncoding | BufferEncodingOption): Buffer | string {
	const value: Buffer = Buffer.from(_readFileSync(path, 'r', false));
	const encoding: BufferEncoding | 'buffer' = typeof options == 'object' ? options.encoding : options;
	if (encoding == 'buffer') {
		return value;
	}
	return value.toString(encoding);
}
readlinkSync satisfies typeof Node.readlinkSync;

// PROPERTY OPERATIONS

/**
 * Synchronous `chown`.
 * @param path
 * @param uid
 * @param gid
 */
export function chownSync(path: PathLike, uid: number, gid: number): void {
	const fd = openSync(path, 'r+');
	fchownSync(fd, uid, gid);
	closeSync(fd);
}
chownSync satisfies typeof Node.chownSync;

/**
 * Synchronous `lchown`.
 * @param path
 * @param uid
 * @param gid
 */
export function lchownSync(path: PathLike, uid: number, gid: number): void {
	const fd = lopenSync(path, 'r+');
	fchownSync(fd, uid, gid);
	closeSync(fd);
}
lchownSync satisfies typeof Node.lchownSync;

/**
 * Synchronous `chmod`.
 * @param path
 * @param mode
 */
export function chmodSync(path: PathLike, mode: Node.Mode): void {
	const fd = openSync(path, 'r+');
	fchmodSync(fd, mode);
	closeSync(fd);
}
chmodSync satisfies typeof Node.chmodSync;

/**
 * Synchronous `lchmod`.
 * @param path
 * @param mode
 */
export function lchmodSync(path: PathLike, mode: number | string): void {
	const fd = lopenSync(path, 'r+');
	fchmodSync(fd, mode);
	closeSync(fd);
}
lchmodSync satisfies typeof Node.lchmodSync;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export function utimesSync(path: PathLike, atime: string | number | Date, mtime: string | number | Date): void {
	const fd = openSync(path, 'r+');
	futimesSync(fd, atime, mtime);
	closeSync(fd);
}
utimesSync satisfies typeof Node.utimesSync;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export function lutimesSync(path: PathLike, atime: string | number | Date, mtime: string | number | Date): void {
	const fd = lopenSync(path, 'r+');
	futimesSync(fd, atime, mtime);
	closeSync(fd);
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
export function realpathSync(path: PathLike, options: BufferEncodingOption): Buffer;
export function realpathSync(path: PathLike, options?: EncodingOption): string;
export function realpathSync(path: PathLike, options?: EncodingOption | BufferEncodingOption): string | Buffer {
	path = normalizePath(path);
	const { fs, path: resolvedPath, mountPoint } = resolveFS(path);
	try {
		const stats = fs.statSync(resolvedPath, cred);
		if (!stats.isSymbolicLink()) {
			return path;
		}
		const dst = normalizePath(mountPoint + Buffer.from(_readFileSync(resolvedPath, 'r+', false)).toString());
		return realpathSync(dst);
	} catch (e) {
		throw fixError(e, { [resolvedPath]: path });
	}
}
realpathSync satisfies Omit<typeof Node.realpathSync, 'native'>;

/**
 * Synchronous `access`.
 * @param path
 * @param mode
 */
export function accessSync(path: PathLike, mode: number = 0o600): void {
	const stats = statSync(path);
	if (!stats.hasAccess(mode, cred)) {
		throw new ApiError(ErrorCode.EACCES);
	}
}
accessSync satisfies typeof Node.accessSync;

/**
 * @todo Implement
 */
export function rmSync(path: PathLike) {
	throw ApiError.With('ENOTSUP', path, 'rmSync');
}
rmSync satisfies typeof Node.rmSync;

/**
 * @todo Implement
 */
export function mkdtempSync(prefix: string, options: BufferEncodingOption): Buffer;
export function mkdtempSync(prefix: string, options?: EncodingOption): string;
export function mkdtempSync(prefix: string, options?: EncodingOption | BufferEncodingOption): string | Buffer {
	throw ApiError.With('ENOTSUP', prefix, 'mkdtempSync');
}
mkdtempSync satisfies typeof Node.mkdtempSync;

/**
 * @todo Implement
 */
export function copyFileSync(src: string, dest: string, flags?: number): void {
	throw ApiError.With('ENOTSUP', src, 'copyFileSync');
}
copyFileSync satisfies typeof Node.copyFileSync;

/**
 * @todo Implement
 */
export function readvSync(fd: number, buffers: readonly Uint8Array[], position?: number): number {
	throw ApiError.With('ENOTSUP', fd2file(fd).path, 'readvSync');
}
readvSync satisfies typeof Node.readvSync;

/**
 * @todo Implement
 */
export function writevSync(fd: number, buffers: readonly Uint8Array[], position?: number): number {
	throw ApiError.With('ENOTSUP', fd2file(fd).path, 'writevSync');
}
writevSync satisfies typeof Node.writevSync;

/**
 * @todo Implement
 */
export function opendirSync(path: PathLike, options?: Node.OpenDirOptions): Dir {
	throw ApiError.With('ENOTSUP', path, 'opendirSync');
}
opendirSync satisfies typeof Node.opendirSync;

/**
 * @todo Implement
 */
export function cpSync(source: PathLike, destination: PathLike, opts?: Node.CopySyncOptions): void {
	throw ApiError.With('ENOTSUP', source, 'cpSync');
}
cpSync satisfies typeof Node.cpSync;

/**
 * Synchronous statfs(2). Returns information about the mounted file system which contains path. The callback gets two arguments (err, stats) where stats is an <fs.StatFs> object.
 * In case of an error, the err.code will be one of Common System Errors.
 * @param path A path to an existing file or directory on the file system to be queried.
 * @param callback
 */
export function statfsSync(path: PathLike, options?: Node.StatFsOptions & { bigint?: false }): StatsFs;
export function statfsSync(path: PathLike, options: Node.StatFsOptions & { bigint: true }): BigIntStatsFs;
export function statfsSync(path: PathLike, options?: Node.StatFsOptions): StatsFs | BigIntStatsFs;
export function statfsSync(path: PathLike, options?: Node.StatFsOptions): StatsFs | BigIntStatsFs {
	throw ApiError.With('ENOTSUP', path, 'statfsSync');
}
