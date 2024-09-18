import { Buffer } from 'buffer';
import type * as fs from 'node:fs';
import { Errno, ErrnoError } from '../error.js';
import type { File } from '../file.js';
import { isAppendable, isExclusive, isReadable, isTruncating, isWriteable, parseFlag } from '../file.js';
import type { FileContents } from '../filesystem.js';
import { BigIntStats, type Stats } from '../stats.js';
import { normalizeMode, normalizeOptions, normalizePath, normalizeTime } from '../utils.js';
import { COPYFILE_EXCL, F_OK, S_IFBLK, S_IFCHR, S_IFDIR, S_IFIFO, S_IFLNK, S_IFMT, S_IFREG, S_IFSOCK } from './constants.js';
import { Dir, Dirent } from './dir.js';
import { dirname, join, parse } from './path.js';
import { _statfs, fd2file, fdMap, file2fd, fixError, mounts, resolveMount } from './shared.js';
import { credentials } from '../credentials.js';
import { emitChange } from './watchers.js';

/**
 * Synchronous rename.
 * @param oldPath
 * @param newPath
 */
export function renameSync(oldPath: fs.PathLike, newPath: fs.PathLike): void {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const _old = resolveMount(oldPath);
	const _new = resolveMount(newPath);
	const paths = { [_old.path]: oldPath, [_new.path]: newPath };
	try {
		if (_old === _new) {
			_old.fs.renameSync(_old.path, _new.path);
			emitChange('rename', oldPath.toString());
			return;
		}

		writeFileSync(newPath, readFileSync(oldPath));
		unlinkSync(oldPath);
		emitChange('rename', oldPath.toString());
	} catch (e) {
		throw fixError(e as Error, paths);
	}
}
renameSync satisfies typeof fs.renameSync;

/**
 * Test whether or not the given path exists by checking with the file system.
 * @param path
 */
export function existsSync(path: fs.PathLike): boolean {
	path = normalizePath(path);
	try {
		const { fs, path: resolvedPath } = resolveMount(realpathSync(path));
		return fs.existsSync(resolvedPath);
	} catch (e) {
		if ((e as ErrnoError).errno == Errno.ENOENT) {
			return false;
		}

		throw e;
	}
}
existsSync satisfies typeof fs.existsSync;

/**
 * Synchronous `stat`.
 * @param path
 * @returns Stats
 */
export function statSync(path: fs.PathLike, options?: { bigint?: boolean }): Stats;
export function statSync(path: fs.PathLike, options: { bigint: true }): BigIntStats;
export function statSync(path: fs.PathLike, options?: fs.StatOptions): Stats | BigIntStats {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(existsSync(path) ? realpathSync(path) : path);
	try {
		const stats = fs.statSync(resolved);
		return options?.bigint ? new BigIntStats(stats) : stats;
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
}
statSync satisfies typeof fs.statSync;

/**
 * Synchronous `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 */
export function lstatSync(path: fs.PathLike, options?: { bigint?: boolean }): Stats;
export function lstatSync(path: fs.PathLike, options: { bigint: true }): BigIntStats;
export function lstatSync(path: fs.PathLike, options?: fs.StatOptions): Stats | BigIntStats {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path);
	try {
		const stats = fs.statSync(resolved);
		return options?.bigint ? new BigIntStats(stats) : stats;
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
}
lstatSync satisfies typeof fs.lstatSync;

/**
 * Synchronous `truncate`.
 * @param path
 * @param len
 */
export function truncateSync(path: fs.PathLike, len: number | null = 0): void {
	using file = _openSync(path, 'r+');
	len ||= 0;
	if (len < 0) {
		throw new ErrnoError(Errno.EINVAL);
	}
	file.truncateSync(len);
}
truncateSync satisfies typeof fs.truncateSync;

/**
 * Synchronous `unlink`.
 * @param path
 */
export function unlinkSync(path: fs.PathLike): void {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path);
	try {
		fs.unlinkSync(resolved);
		emitChange('rename', path.toString());
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
}
unlinkSync satisfies typeof fs.unlinkSync;

function _openSync(path: fs.PathLike, _flag: fs.OpenMode, _mode?: fs.Mode | null, resolveSymlinks: boolean = true): File {
	path = normalizePath(path);
	const mode = normalizeMode(_mode, 0o644),
		flag = parseFlag(_flag);

	path = resolveSymlinks && existsSync(path) ? realpathSync(path) : path;
	const { fs, path: resolved } = resolveMount(path);

	if (!fs.existsSync(resolved)) {
		if ((!isWriteable(flag) && !isAppendable(flag)) || flag == 'r+') {
			throw ErrnoError.With('ENOENT', path, '_open');
		}
		// Create the file
		const parentStats: Stats = fs.statSync(dirname(resolved));
		if (!parentStats.isDirectory()) {
			throw ErrnoError.With('ENOTDIR', dirname(path), '_open');
		}
		return fs.createFileSync(resolved, flag, mode);
	}

	const stats: Stats = fs.statSync(resolved);

	if (!stats.hasAccess(mode, credentials)) {
		throw ErrnoError.With('EACCES', path, '_open');
	}

	if (isExclusive(flag)) {
		throw ErrnoError.With('EEXIST', path, '_open');
	}

	if (!isTruncating(flag)) {
		return fs.openFileSync(resolved, flag);
	}

	// Delete file.
	fs.unlinkSync(resolved);
	/*
		Create file. Use the same mode as the old file.
		Node itself modifies the ctime when this occurs, so this action
		will preserve that behavior if the underlying file system
		supports those properties.
	*/
	return fs.createFileSync(resolved, flag, stats.mode);
}

/**
 * Synchronous file open.
 * @see http://www.manpagez.com/man/2/open/
 * @param flags Handles the complexity of the various file
 *   modes. See its API for more details.
 * @param mode Mode to use to open the file. Can be ignored if the
 *   filesystem doesn't support permissions.
 */
export function openSync(path: fs.PathLike, flag: fs.OpenMode, mode: fs.Mode | null = F_OK): number {
	return file2fd(_openSync(path, flag, mode, true));
}
openSync satisfies typeof fs.openSync;

/**
 * Opens a file or symlink
 * @internal
 */
export function lopenSync(path: fs.PathLike, flag: string, mode?: fs.Mode | null): number {
	return file2fd(_openSync(path, flag, mode, false));
}

/**
 * Synchronously reads the entire contents of a file.
 */
function _readFileSync(fname: string, flag: string, resolveSymlinks: boolean): Uint8Array {
	// Get file.
	using file = _openSync(fname, flag, 0o644, resolveSymlinks);
	const stat = file.statSync();
	// Allocate buffer.
	const data = new Uint8Array(stat.size);
	file.readSync(data, 0, stat.size, 0);
	return data;
}

/**
 * Synchronously reads the entire contents of a file.
 * @param path
 * @param options
 * @option options encoding The string encoding for the file contents. Defaults to `null`.
 * @option options flag Defaults to `'r'`.
 * @returns file contents
 */
export function readFileSync(path: fs.PathOrFileDescriptor, options?: { flag?: string } | null): Buffer;
export function readFileSync(path: fs.PathOrFileDescriptor, options?: (fs.EncodingOption & { flag?: string }) | BufferEncoding | null): string;
export function readFileSync(path: fs.PathOrFileDescriptor, _options: fs.WriteFileOptions | null = {}): FileContents {
	const options = normalizeOptions(_options, null, 'r', 0o644);
	const flag = parseFlag(options.flag);
	if (!isReadable(flag)) {
		throw new ErrnoError(Errno.EINVAL, 'Flag passed to readFile must allow for reading.');
	}
	const data: Buffer = Buffer.from(_readFileSync(typeof path == 'number' ? fd2file(path).path : path.toString(), options.flag, true));
	return options.encoding ? data.toString(options.encoding) : data;
}
readFileSync satisfies typeof fs.readFileSync;

/**
 * Synchronously writes data to a file, replacing the file if it already
 * exists.
 *
 * The encoding option is ignored if data is a buffer.
 * @param path
 * @param data
 * @param options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'w'`.
 */
export function writeFileSync(path: fs.PathOrFileDescriptor, data: FileContents, options?: fs.WriteFileOptions): void;
export function writeFileSync(path: fs.PathOrFileDescriptor, data: FileContents, encoding?: BufferEncoding): void;
export function writeFileSync(path: fs.PathOrFileDescriptor, data: FileContents, _options: fs.WriteFileOptions | BufferEncoding = {}): void {
	const options = normalizeOptions(_options, 'utf8', 'w+', 0o644);
	const flag = parseFlag(options.flag);
	if (!isWriteable(flag)) {
		throw new ErrnoError(Errno.EINVAL, 'Flag passed to writeFile must allow for writing.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ErrnoError(Errno.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	if (!encodedData) {
		throw new ErrnoError(Errno.EINVAL, 'Data not specified');
	}
	using file = _openSync(typeof path == 'number' ? fd2file(path).path : path.toString(), flag, options.mode, true);
	file.writeSync(encodedData, 0, encodedData.byteLength, 0);
	emitChange('change', path.toString());
}
writeFileSync satisfies typeof fs.writeFileSync;

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
export function appendFileSync(filename: fs.PathOrFileDescriptor, data: FileContents, _options: fs.WriteFileOptions = {}): void {
	const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
	const flag = parseFlag(options.flag);
	if (!isAppendable(flag)) {
		throw new ErrnoError(Errno.EINVAL, 'Flag passed to appendFile must allow for appending.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ErrnoError(Errno.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	using file = _openSync(typeof filename == 'number' ? fd2file(filename).path : filename.toString(), flag, options.mode, true);
	file.writeSync(encodedData, 0, encodedData.byteLength);
}
appendFileSync satisfies typeof fs.appendFileSync;

/**
 * Synchronous `fstat`.
 * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
 * specified by the file descriptor `fd`.
 * @param fd
 */
export function fstatSync(fd: number, options?: { bigint?: boolean }): Stats;
export function fstatSync(fd: number, options: { bigint: true }): BigIntStats;
export function fstatSync(fd: number, options?: fs.StatOptions): Stats | BigIntStats {
	const stats: Stats = fd2file(fd).statSync();
	return options?.bigint ? new BigIntStats(stats) : stats;
}
fstatSync satisfies typeof fs.fstatSync;

/**
 * Synchronous close.
 * @param fd
 */
export function closeSync(fd: number): void {
	fd2file(fd).closeSync();
	fdMap.delete(fd);
}
closeSync satisfies typeof fs.closeSync;

/**
 * Synchronous ftruncate.
 * @param fd
 * @param len
 */
export function ftruncateSync(fd: number, len: number | null = 0): void {
	len ||= 0;
	if (len < 0) {
		throw new ErrnoError(Errno.EINVAL);
	}
	fd2file(fd).truncateSync(len);
}
ftruncateSync satisfies typeof fs.ftruncateSync;

/**
 * Synchronous fsync.
 * @param fd
 */
export function fsyncSync(fd: number): void {
	fd2file(fd).syncSync();
}
fsyncSync satisfies typeof fs.fsyncSync;

/**
 * Synchronous fdatasync.
 * @param fd
 */
export function fdatasyncSync(fd: number): void {
	fd2file(fd).datasyncSync();
}
fdatasyncSync satisfies typeof fs.fdatasyncSync;

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
export function writeSync(fd: number, data: ArrayBufferView, offset?: number | null, length?: number | null, position?: number | null): number;
export function writeSync(fd: number, data: string, position?: number | null, encoding?: BufferEncoding | null): number;
export function writeSync(fd: number, data: FileContents, posOrOff?: number | null, lenOrEnc?: BufferEncoding | number | null, pos?: number | null): number {
	let buffer: Uint8Array, offset: number | undefined, length: number, position: number | null;
	if (typeof data === 'string') {
		// Signature 1: (fd, string, [position?, [encoding?]])
		position = typeof posOrOff === 'number' ? posOrOff : null;
		const encoding = typeof lenOrEnc === 'string' ? lenOrEnc : ('utf8' as BufferEncoding);
		offset = 0;
		buffer = Buffer.from(data, encoding);
		length = buffer.byteLength;
	} else {
		// Signature 2: (fd, buffer, offset, length, position?)
		buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		offset = posOrOff!;
		length = lenOrEnc as number;
		position = typeof pos === 'number' ? pos : null;
	}

	const file = fd2file(fd);
	position ??= file.position;
	const bytesWritten = file.writeSync(buffer, offset, length, position);
	emitChange('change', file.path);
	return bytesWritten;
}
writeSync satisfies typeof fs.writeSync;

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
export function readSync(fd: number, buffer: ArrayBufferView, opts?: fs.ReadSyncOptions): number;
export function readSync(fd: number, buffer: ArrayBufferView, offset: number, length: number, position?: fs.ReadPosition | null): number;
export function readSync(fd: number, buffer: ArrayBufferView, opts?: fs.ReadSyncOptions | number, length?: number, position?: fs.ReadPosition | null): number {
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
readSync satisfies typeof fs.readSync;

/**
 * Synchronous `fchown`.
 * @param fd
 * @param uid
 * @param gid
 */
export function fchownSync(fd: number, uid: number, gid: number): void {
	fd2file(fd).chownSync(uid, gid);
}
fchownSync satisfies typeof fs.fchownSync;

/**
 * Synchronous `fchmod`.
 * @param fd
 * @param mode
 */
export function fchmodSync(fd: number, mode: number | string): void {
	const numMode = normalizeMode(mode, -1);
	if (numMode < 0) {
		throw new ErrnoError(Errno.EINVAL, `Invalid mode.`);
	}
	fd2file(fd).chmodSync(numMode);
}
fchmodSync satisfies typeof fs.fchmodSync;

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
futimesSync satisfies typeof fs.futimesSync;

/**
 * Synchronous `rmdir`.
 * @param path
 */
export function rmdirSync(path: fs.PathLike): void {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(existsSync(path) ? realpathSync(path) : path);
	try {
		fs.rmdirSync(resolved);
		emitChange('rename', path.toString());
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
}
rmdirSync satisfies typeof fs.rmdirSync;

/**
 * Synchronous `mkdir`.
 * @param path
 * @param mode defaults to o777
 */
export function mkdirSync(path: fs.PathLike, options: fs.MakeDirectoryOptions & { recursive: true }): string | undefined;
export function mkdirSync(path: fs.PathLike, options?: fs.Mode | (fs.MakeDirectoryOptions & { recursive?: false }) | null): void;
export function mkdirSync(path: fs.PathLike, options?: fs.Mode | fs.MakeDirectoryOptions | null): string | undefined;
export function mkdirSync(path: fs.PathLike, options?: fs.Mode | fs.MakeDirectoryOptions | null): string | undefined | void {
	options = typeof options === 'object' ? options : { mode: options };
	const mode = normalizeMode(options?.mode, 0o777);

	path = normalizePath(path);
	path = existsSync(path) ? realpathSync(path) : path;
	const { fs, path: resolved } = resolveMount(path);
	const errorPaths: Record<string, string> = { [resolved]: path };

	try {
		if (!options?.recursive) {
			return fs.mkdirSync(resolved, mode);
		}

		const dirs: string[] = [];
		for (let dir = resolved, original = path; !fs.existsSync(dir); dir = dirname(dir), original = dirname(original)) {
			dirs.unshift(dir);
			errorPaths[dir] = original;
		}
		for (const dir of dirs) {
			fs.mkdirSync(dir, mode);
			emitChange('rename', dir);
		}
		return dirs[0];
	} catch (e) {
		throw fixError(e as Error, errorPaths);
	}
}
mkdirSync satisfies typeof fs.mkdirSync;

/**
 * Synchronous `readdir`. Reads the contents of a directory.
 * @param path
 */
export function readdirSync(path: fs.PathLike, options?: { recursive?: boolean; encoding?: BufferEncoding | null; withFileTypes?: false } | BufferEncoding | null): string[];
export function readdirSync(path: fs.PathLike, options: { recursive?: boolean; encoding: 'buffer'; withFileTypes?: false } | 'buffer'): Buffer[];
export function readdirSync(path: fs.PathLike, options: { recursive?: boolean; withFileTypes: true }): Dirent[];
export function readdirSync(path: fs.PathLike, options?: (fs.ObjectEncodingOptions & { withFileTypes?: false; recursive?: boolean }) | BufferEncoding | null): string[] | Buffer[];
export function readdirSync(
	path: fs.PathLike,
	options?: { recursive?: boolean; encoding?: BufferEncoding | 'buffer' | null; withFileTypes?: boolean } | BufferEncoding | 'buffer' | null
): string[] | Dirent[] | Buffer[] {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(existsSync(path) ? realpathSync(path) : path);
	let entries: string[];
	try {
		entries = fs.readdirSync(resolved);
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
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
	return entries.map((entry: string) => {
		if (typeof options == 'object' && options?.withFileTypes) {
			return new Dirent(entry, statSync(join(path.toString(), entry)));
		}

		if (options == 'buffer' || (typeof options == 'object' && options?.encoding == 'buffer')) {
			return Buffer.from(entry);
		}

		return entry;
	}) as string[] | Dirent[] | Buffer[];
}
readdirSync satisfies typeof fs.readdirSync;

// SYMLINK METHODS

/**
 * Synchronous `link`.
 * @param existing
 * @param newpath
 */
export function linkSync(existing: fs.PathLike, newpath: fs.PathLike): void {
	existing = normalizePath(existing);
	newpath = normalizePath(newpath);
	const { fs, path: resolved } = resolveMount(existing);
	try {
		return fs.linkSync(resolved, newpath);
	} catch (e) {
		throw fixError(e as Error, { [resolved]: existing });
	}
}
linkSync satisfies typeof fs.linkSync;

/**
 * Synchronous `symlink`.
 * @param target target path
 * @param path link path
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 */
export function symlinkSync(target: fs.PathLike, path: fs.PathLike, type: fs.symlink.Type | null = 'file'): void {
	if (!['file', 'dir', 'junction'].includes(type!)) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid type: ' + type);
	}
	if (existsSync(path)) {
		throw ErrnoError.With('EEXIST', path.toString(), 'symlink');
	}

	writeFileSync(path, target.toString());
	const file = _openSync(path, 'r+', 0o644, false);
	file._setTypeSync(S_IFLNK);
}
symlinkSync satisfies typeof fs.symlinkSync;

/**
 * Synchronous readlink.
 * @param path
 */
export function readlinkSync(path: fs.PathLike, options?: fs.BufferEncodingOption): Buffer;
export function readlinkSync(path: fs.PathLike, options: fs.EncodingOption | BufferEncoding): string;
export function readlinkSync(path: fs.PathLike, options?: fs.EncodingOption | BufferEncoding | fs.BufferEncodingOption): Buffer | string;
export function readlinkSync(path: fs.PathLike, options?: fs.EncodingOption | BufferEncoding | fs.BufferEncodingOption): Buffer | string {
	const value: Buffer = Buffer.from(_readFileSync(path.toString(), 'r', false));
	const encoding = typeof options == 'object' ? options?.encoding : options;
	if (encoding == 'buffer') {
		return value;
	}
	return value.toString(encoding!);
}
readlinkSync satisfies typeof fs.readlinkSync;

// PROPERTY OPERATIONS

/**
 * Synchronous `chown`.
 * @param path
 * @param uid
 * @param gid
 */
export function chownSync(path: fs.PathLike, uid: number, gid: number): void {
	const fd = openSync(path, 'r+');
	fchownSync(fd, uid, gid);
	closeSync(fd);
}
chownSync satisfies typeof fs.chownSync;

/**
 * Synchronous `lchown`.
 * @param path
 * @param uid
 * @param gid
 */
export function lchownSync(path: fs.PathLike, uid: number, gid: number): void {
	const fd = lopenSync(path, 'r+');
	fchownSync(fd, uid, gid);
	closeSync(fd);
}
lchownSync satisfies typeof fs.lchownSync;

/**
 * Synchronous `chmod`.
 * @param path
 * @param mode
 */
export function chmodSync(path: fs.PathLike, mode: fs.Mode): void {
	const fd = openSync(path, 'r+');
	fchmodSync(fd, mode);
	closeSync(fd);
}
chmodSync satisfies typeof fs.chmodSync;

/**
 * Synchronous `lchmod`.
 * @param path
 * @param mode
 */
export function lchmodSync(path: fs.PathLike, mode: number | string): void {
	const fd = lopenSync(path, 'r+');
	fchmodSync(fd, mode);
	closeSync(fd);
}
lchmodSync satisfies typeof fs.lchmodSync;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export function utimesSync(path: fs.PathLike, atime: string | number | Date, mtime: string | number | Date): void {
	const fd = openSync(path, 'r+');
	futimesSync(fd, atime, mtime);
	closeSync(fd);
}
utimesSync satisfies typeof fs.utimesSync;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export function lutimesSync(path: fs.PathLike, atime: string | number | Date, mtime: string | number | Date): void {
	const fd = lopenSync(path, 'r+');
	futimesSync(fd, atime, mtime);
	closeSync(fd);
}
lutimesSync satisfies typeof fs.lutimesSync;

/**
 * Synchronous `realpath`.
 * @param path
 * @param cache An object literal of mapped paths that can be used to
 *   force a specific path resolution or avoid additional `fs.stat` calls for
 *   known real paths.
 * @returns the real path
 */
export function realpathSync(path: fs.PathLike, options: fs.BufferEncodingOption): Buffer;
export function realpathSync(path: fs.PathLike, options?: fs.EncodingOption): string;
export function realpathSync(path: fs.PathLike, options?: fs.EncodingOption | fs.BufferEncodingOption): string | Buffer {
	path = normalizePath(path);
	const { base, dir } = parse(path);
	const lpath = join(dir == '/' ? '/' : realpathSync(dir), base);
	const { fs, path: resolvedPath, mountPoint } = resolveMount(lpath);

	try {
		const stats = fs.statSync(resolvedPath);
		if (!stats.isSymbolicLink()) {
			return lpath;
		}

		return realpathSync(mountPoint + readlinkSync(lpath, options).toString());
	} catch (e) {
		throw fixError(e as Error, { [resolvedPath]: lpath });
	}
}
realpathSync satisfies Omit<typeof fs.realpathSync, 'native'>;

/**
 * Synchronous `access`.
 * @param path
 * @param mode
 */
export function accessSync(path: fs.PathLike, mode: number = 0o600): void {
	const stats = statSync(path);
	if (!stats.hasAccess(mode, credentials)) {
		throw new ErrnoError(Errno.EACCES);
	}
}
accessSync satisfies typeof fs.accessSync;

/**
 * Synchronous `rm`. Removes files or directories (recursively).
 * @param path The path to the file or directory to remove.
 */
export function rmSync(path: fs.PathLike, options?: fs.RmOptions): void {
	path = normalizePath(path);

	const stats = statSync(path);

	switch (stats.mode & S_IFMT) {
		case S_IFDIR:
			if (options?.recursive) {
				for (const entry of readdirSync(path)) {
					rmSync(join(path, entry), options);
				}
			}

			rmdirSync(path);
			return;
		case S_IFREG:
		case S_IFLNK:
			unlinkSync(path);
			return;
		case S_IFBLK:
		case S_IFCHR:
		case S_IFIFO:
		case S_IFSOCK:
		default:
			throw new ErrnoError(Errno.EPERM, 'File type not supported', path, 'rm');
	}
}
rmSync satisfies typeof fs.rmSync;

/**
 * Synchronous `mkdtemp`. Creates a unique temporary directory.
 * @param prefix The directory prefix.
 * @param options The encoding (or an object including `encoding`).
 * @returns The path to the created temporary directory, encoded as a string or buffer.
 */
export function mkdtempSync(prefix: string, options: fs.BufferEncodingOption): Buffer;
export function mkdtempSync(prefix: string, options?: fs.EncodingOption): string;
export function mkdtempSync(prefix: string, options?: fs.EncodingOption | fs.BufferEncodingOption): string | Buffer {
	const encoding = typeof options === 'object' ? options?.encoding : options || 'utf8';
	const fsName = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const resolvedPath = '/tmp/' + fsName;

	mkdirSync(resolvedPath);

	return encoding == 'buffer' ? Buffer.from(resolvedPath) : resolvedPath;
}
mkdtempSync satisfies typeof fs.mkdtempSync;

/**
 * Synchronous `copyFile`. Copies a file.
 * @param src The source file.
 * @param dest The destination file.
 * @param flags Optional flags for the copy operation. Currently supports these flags:
 *    * `fs.constants.COPYFILE_EXCL`: If the destination file already exists, the operation fails.
 */
export function copyFileSync(src: fs.PathLike, dest: fs.PathLike, flags?: number): void {
	src = normalizePath(src);
	dest = normalizePath(dest);

	if (flags && flags & COPYFILE_EXCL && existsSync(dest)) {
		throw new ErrnoError(Errno.EEXIST, 'Destination file already exists.', dest, 'copyFile');
	}

	writeFileSync(dest, readFileSync(src));
	emitChange('rename', dest.toString());
}
copyFileSync satisfies typeof fs.copyFileSync;

/**
 * Synchronous `readv`. Reads from a file descriptor into multiple buffers.
 * @param fd The file descriptor.
 * @param buffers An array of Uint8Array buffers.
 * @param position The position in the file where to begin reading.
 * @returns The number of bytes read.
 */
export function readvSync(fd: number, buffers: readonly NodeJS.ArrayBufferView[], position?: number): number {
	const file = fd2file(fd);
	let bytesRead = 0;

	for (const buffer of buffers) {
		bytesRead += file.readSync(buffer, 0, buffer.byteLength, position! + bytesRead);
	}

	return bytesRead;
}
readvSync satisfies typeof fs.readvSync;

/**
 * Synchronous `writev`. Writes from multiple buffers into a file descriptor.
 * @param fd The file descriptor.
 * @param buffers An array of Uint8Array buffers.
 * @param position The position in the file where to begin writing.
 * @returns The number of bytes written.
 */
export function writevSync(fd: number, buffers: readonly ArrayBufferView[], position?: number): number {
	const file = fd2file(fd);
	let bytesWritten = 0;

	for (const buffer of buffers) {
		bytesWritten += file.writeSync(new Uint8Array(buffer.buffer), 0, buffer.byteLength, position! + bytesWritten);
	}

	return bytesWritten;
}
writevSync satisfies typeof fs.writevSync;

/**
 * Synchronous `opendir`. Opens a directory.
 * @param path The path to the directory.
 * @param options Options for opening the directory.
 * @returns A `Dir` object representing the opened directory.
 */
export function opendirSync(path: fs.PathLike, options?: fs.OpenDirOptions): Dir {
	path = normalizePath(path);
	return new Dir(path); // Re-use existing `Dir` class
}
opendirSync satisfies typeof fs.opendirSync;

/**
 * Synchronous `cp`. Recursively copies a file or directory.
 * @param source The source file or directory.
 * @param destination The destination file or directory.
 * @param opts Options for the copy operation. Currently supports these options from Node.js 'fs.cpSync':
 *   * `dereference`: Dereference symbolic links.
 *   * `errorOnExist`: Throw an error if the destination file or directory already exists.
 *   * `filter`: A function that takes a source and destination path and returns a boolean, indicating whether to copy the given source element.
 *   * `force`: Overwrite the destination if it exists, and overwrite existing readonly destination files.
 *   * `preserveTimestamps`: Preserve file timestamps.
 *   * `recursive`: If `true`, copies directories recursively.
 */
export function cpSync(source: fs.PathLike, destination: fs.PathLike, opts?: fs.CopySyncOptions): void {
	source = normalizePath(source);
	destination = normalizePath(destination);

	const srcStats = lstatSync(source); // Use lstat to follow symlinks if not dereferencing

	if (opts?.errorOnExist && existsSync(destination)) {
		throw new ErrnoError(Errno.EEXIST, 'Destination file or directory already exists.', destination, 'cp');
	}

	switch (srcStats.mode & S_IFMT) {
		case S_IFDIR:
			if (!opts?.recursive) {
				throw new ErrnoError(Errno.EISDIR, source + ' is a directory (not copied)', source, 'cp');
			}
			mkdirSync(destination, { recursive: true }); // Ensure the destination directory exists
			for (const dirent of readdirSync(source, { withFileTypes: true })) {
				if (opts.filter && !opts.filter(join(source, dirent.name), join(destination, dirent.name))) {
					continue; // Skip if the filter returns false
				}
				cpSync(join(source, dirent.name), join(destination, dirent.name), opts);
			}
			break;
		case S_IFREG:
		case S_IFLNK:
			copyFileSync(source, destination);
			break;
		case S_IFBLK:
		case S_IFCHR:
		case S_IFIFO:
		case S_IFSOCK:
		default:
			throw new ErrnoError(Errno.EPERM, 'File type not supported', source, 'rm');
	}

	// Optionally preserve timestamps
	if (opts?.preserveTimestamps) {
		utimesSync(destination, srcStats.atime, srcStats.mtime);
	}
}
cpSync satisfies typeof fs.cpSync;

/**
 * Synchronous statfs(2). Returns information about the mounted file system which contains path.
 * In case of an error, the err.code will be one of Common System Errors.
 * @param path A path to an existing file or directory on the file system to be queried.
 * @param callback
 */
export function statfsSync(path: fs.PathLike, options?: fs.StatFsOptions & { bigint?: false }): fs.StatsFs;
export function statfsSync(path: fs.PathLike, options: fs.StatFsOptions & { bigint: true }): fs.BigIntStatsFs;
export function statfsSync(path: fs.PathLike, options?: fs.StatFsOptions): fs.StatsFs | fs.BigIntStatsFs;
export function statfsSync(path: fs.PathLike, options?: fs.StatFsOptions): fs.StatsFs | fs.BigIntStatsFs {
	path = normalizePath(path);
	const { fs } = resolveMount(path);
	return _statfs(fs, options?.bigint);
}
