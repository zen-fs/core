import type * as Node from 'fs';
import { ApiError, ErrorCode } from '../ApiError.js';
import { TwoArgCallback, NoArgCallback, ThreeArgCallback, FileContents } from '../filesystem.js';
import { BigIntStats, Stats } from '../stats.js';
import { fd2file, nop, normalizeMode, PathLike } from './shared.js';
import * as promises from './promises.js';
import { R_OK } from './constants.js';
import { decode, encode } from '../utils.js';
import { ReadStream, WriteStream } from './streams.js';
import { Dirent } from './dir.js';

/**
 * Asynchronous rename. No arguments other than a possible exception are given
 * to the completion callback.
 * @param oldPath
 * @param newPath
 * @param callback
 */
export function rename(oldPath: PathLike, newPath: PathLike, cb: NoArgCallback = nop): void {
	promises
		.rename(oldPath, newPath)
		.then(() => cb())
		.catch(cb);
}
rename satisfies Omit<typeof Node.rename, '__promisify__'>;

/**
 * Test whether or not the given path exists by checking with the file system.
 * Then call the callback argument with either true or false.
 * @param path
 * @param callback
 */
export function exists(path: PathLike, cb: (exists: boolean) => unknown = nop): void {
	promises
		.exists(path)
		.then(cb)
		.catch(() => cb(false));
}
exists satisfies Omit<typeof Node.exists, '__promisify__'>;

/**
 * Asynchronous `stat`.
 * @param path
 * @param callback
 */
export function stat(path: PathLike, callback: TwoArgCallback<Stats>): void;
export function stat(path: PathLike, options: Node.StatOptions & { bigint?: false }, callback: TwoArgCallback<Stats>): void;
export function stat(path: PathLike, options: Node.StatOptions & { bigint: true }, callback: TwoArgCallback<BigIntStats>): void;
export function stat(path: PathLike, options: Node.StatOptions, callback: TwoArgCallback<Stats | BigIntStats>): void;
export function stat(path: PathLike, options?: Node.StatOptions | TwoArgCallback<Stats>, callback: TwoArgCallback<Stats> | TwoArgCallback<BigIntStats> = nop): void {
	callback = typeof options == 'function' ? options : callback;
	promises
		.stat(path, typeof options != 'function' ? options : ({} as object))
		.then(stats => callback(null, stats as Stats & BigIntStats))
		.catch(callback);
}
stat satisfies Omit<typeof Node.stat, '__promisify__'>;

/**
 * Asynchronous `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 * @param callback
 */
export function lstat(path: PathLike, callback: TwoArgCallback<Stats>): void;
export function lstat(path: PathLike, options: Node.StatOptions & { bigint?: false }, callback: TwoArgCallback<Stats>): void;
export function lstat(path: PathLike, options: Node.StatOptions & { bigint: true }, callback: TwoArgCallback<BigIntStats>): void;
export function lstat(path: PathLike, options: Node.StatOptions, callback: TwoArgCallback<Stats | BigIntStats>): void;
export function lstat(path: PathLike, options?: Node.StatOptions | TwoArgCallback<Stats>, callback: TwoArgCallback<Stats> | TwoArgCallback<BigIntStats> = nop): void {
	callback = typeof options == 'function' ? options : callback;
	promises
		.lstat(path, typeof options != 'function' ? options : ({} as object))
		.then(stats => callback(null, stats as Stats & BigIntStats))
		.catch(callback);
}
lstat satisfies Omit<typeof Node.lstat, '__promisify__'>;

/**
 * Asynchronous `truncate`.
 * @param path
 * @param len
 * @param callback
 */
export function truncate(path: PathLike, cb?: NoArgCallback): void;
export function truncate(path: PathLike, len: number, cb?: NoArgCallback): void;
export function truncate(path: PathLike, arg2: number | NoArgCallback = 0, cb: NoArgCallback = nop): void {
	cb = typeof arg2 === 'function' ? arg2 : cb;
	const len = typeof arg2 === 'number' ? arg2 : 0;
	promises
		.truncate(path, len)
		.then(() => cb())
		.catch(cb);
}
truncate satisfies Omit<typeof Node.truncate, '__promisify__'>;

/**
 * Asynchronous `unlink`.
 * @param path
 * @param callback
 */
export function unlink(path: PathLike, cb: NoArgCallback = nop): void {
	promises
		.unlink(path)
		.then(() => cb())
		.catch(cb);
}
unlink satisfies Omit<typeof Node.unlink, '__promisify__'>;

/**
 * Asynchronous file open.
 * Exclusive mode ensures that path is newly created.
 *
 * `flags` can be:
 *
 * * `'r'` - Open file for reading. An exception occurs if the file does not exist.
 * * `'r+'` - Open file for reading and writing. An exception occurs if the file does not exist.
 * * `'rs'` - Open file for reading in synchronous mode. Instructs the filesystem to not cache writes.
 * * `'rs+'` - Open file for reading and writing, and opens the file in synchronous mode.
 * * `'w'` - Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
 * * `'wx'` - Like 'w' but opens the file in exclusive mode.
 * * `'w+'` - Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists).
 * * `'wx+'` - Like 'w+' but opens the file in exclusive mode.
 * * `'a'` - Open file for appending. The file is created if it does not exist.
 * * `'ax'` - Like 'a' but opens the file in exclusive mode.
 * * `'a+'` - Open file for reading and appending. The file is created if it does not exist.
 * * `'ax+'` - Like 'a+' but opens the file in exclusive mode.
 *
 * @see http://www.manpagez.com/man/2/open/
 * @param path
 * @param flags
 * @param mode defaults to `0644`
 * @param callback
 */
export function open(path: PathLike, flag: string, cb?: TwoArgCallback<number>): void;
export function open(path: PathLike, flag: string, mode: number | string, cb?: TwoArgCallback<number>): void;
export function open(path: PathLike, flag: string, arg2?: number | string | TwoArgCallback<number>, cb: TwoArgCallback<number> = nop): void {
	const mode = normalizeMode(arg2, 0o644);
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises
		.open(path, flag, mode)
		.then(handle => cb(null, handle.fd))
		.catch(cb);
}
open satisfies Omit<typeof Node.open, '__promisify__'>;

/**
 * Asynchronously reads the entire contents of a file.
 * @example Usage example
 *   fs.readFile('/etc/passwd', function (err, data) {
 *     if (err) throw err;
 *     console.log(data);
 *   });
 * @param filename
 * @param options
 * @option options encoding The string encoding for the file contents. Defaults to `null`.
 * @option options flag Defaults to `'r'`.
 * @param callback If no encoding is specified, then the raw buffer is returned.
 */
export function readFile(filename: PathLike, cb: TwoArgCallback<Uint8Array>): void;
export function readFile(filename: PathLike, options: { flag?: string }, callback?: TwoArgCallback<Uint8Array>): void;
export function readFile(filename: PathLike, optios: { encoding: BufferEncoding; flag?: string } | BufferEncoding, cb: TwoArgCallback<string>): void;
export function readFile(
	filename: PathLike,
	options?: Node.WriteFileOptions | BufferEncoding | TwoArgCallback<Uint8Array>,
	cb: TwoArgCallback<string> | TwoArgCallback<Uint8Array> = nop
) {
	cb = typeof options === 'function' ? options : cb;

	promises
		.readFile(filename, typeof options === 'function' ? null : options)
		.then(data => cb(null, <string & Uint8Array>data))
		.catch(cb);
}
readFile satisfies Omit<typeof Node.readFile, '__promisify__'>;

/**
 * Asynchronously writes data to a file, replacing the file if it already
 * exists.
 *
 * The encoding option is ignored if data is a buffer.
 *
 * @param filename
 * @param data
 * @param options
 * @option encoding Defaults to `'utf8'`.
 * @option mode Defaults to `0644`.
 * @option flag Defaults to `'w'`.
 * @param callback
 */
export function writeFile(filename: PathLike, data: FileContents, cb?: NoArgCallback): void;
export function writeFile(filename: PathLike, data: FileContents, encoding?: BufferEncoding, cb?: NoArgCallback): void;
export function writeFile(filename: PathLike, data: FileContents, options?: Node.WriteFileOptions, cb?: NoArgCallback): void;
export function writeFile(filename: PathLike, data: FileContents, arg3?: Node.WriteFileOptions | NoArgCallback, cb: NoArgCallback = nop): void {
	cb = typeof arg3 === 'function' ? arg3 : cb;
	promises
		.writeFile(filename, data, typeof arg3 != 'function' ? arg3 : null)
		.then(() => cb(null))
		.catch(cb);
}
writeFile satisfies Omit<typeof Node.writeFile, '__promisify__'>;

/**
 * Asynchronously append data to a file, creating the file if it not yet
 * exists.
 *
 * @param filename
 * @param data
 * @param options
 * @option encoding Defaults to `'utf8'`.
 * @option mode Defaults to `0644`.
 * @option flag Defaults to `'a'`.
 * @param callback
 */
export function appendFile(filename: PathLike, data: FileContents, cb?: NoArgCallback): void;
export function appendFile(filename: PathLike, data: FileContents, options?: { encoding?: string; mode?: number | string; flag?: string }, cb?: NoArgCallback): void;
export function appendFile(filename: PathLike, data: FileContents, encoding?: string, cb?: NoArgCallback): void;
export function appendFile(filename: PathLike, data: FileContents, arg3?: any, cb: NoArgCallback = nop): void {
	cb = typeof arg3 === 'function' ? arg3 : cb;
	promises.appendFile(filename, data, typeof arg3 === 'function' ? null : arg3);
}
appendFile satisfies Omit<typeof Node.appendFile, '__promisify__'>;

/**
 * Asynchronous `fstat`.
 * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
 * specified by the file descriptor `fd`.
 * @param fd
 * @param callback
 */
export function fstat(fd: number, cb: TwoArgCallback<Stats>): void;
export function fstat(fd: number, options: Node.StatOptions & { bigint?: false }, cb: TwoArgCallback<Stats>): void;
export function fstat(fd: number, options: Node.StatOptions & { bigint: true }, cb: TwoArgCallback<BigIntStats>): void;
export function fstat(fd: number, options?: Node.StatOptions | TwoArgCallback<Stats>, cb: TwoArgCallback<Stats> | TwoArgCallback<BigIntStats> = nop): void {
	cb = typeof options == 'function' ? options : cb;

	fd2file(fd)
		.stat()
		.then(stats => cb(null, <Stats & BigIntStats>(typeof options == 'object' && options?.bigint ? BigIntStats.clone(stats) : stats)))
		.catch(cb);
}
fstat satisfies Omit<typeof Node.fstat, '__promisify__'>;

/**
 * Asynchronous close.
 * @param fd
 * @param callback
 */
export function close(fd: number, cb: NoArgCallback = nop): void {
	new promises.FileHandle(fd)
		.close()
		.then(() => cb())
		.catch(cb);
}
close satisfies Omit<typeof Node.close, '__promisify__'>;

/**
 * Asynchronous ftruncate.
 * @param fd
 * @param len
 * @param callback
 */
export function ftruncate(fd: number, cb?: NoArgCallback): void;
export function ftruncate(fd: number, len?: number, cb?: NoArgCallback): void;
export function ftruncate(fd: number, lenOrCB?: any, cb: NoArgCallback = nop): void {
	const length = typeof lenOrCB === 'number' ? lenOrCB : 0;
	cb = typeof lenOrCB === 'function' ? lenOrCB : cb;
	const file = fd2file(fd);
	if (length < 0) {
		throw new ApiError(ErrorCode.EINVAL);
	}
	file.truncate(length)
		.then(() => cb())
		.catch(cb);
}
ftruncate satisfies Omit<typeof Node.ftruncate, '__promisify__'>;

/**
 * Asynchronous fsync.
 * @param fd
 * @param callback
 */
export function fsync(fd: number, cb: NoArgCallback = nop): void {
	fd2file(fd)
		.sync()
		.then(() => cb())
		.catch(cb);
}
fsync satisfies Omit<typeof Node.fsync, '__promisify__'>;

/**
 * Asynchronous fdatasync.
 * @param fd
 * @param callback
 */
export function fdatasync(fd: number, cb: NoArgCallback = nop): void {
	fd2file(fd)
		.datasync()
		.then(() => cb())
		.catch(cb);
}
fdatasync satisfies Omit<typeof Node.fdatasync, '__promisify__'>;

/**
 * Write buffer to the file specified by `fd`.
 * Note that it is unsafe to use fs.write multiple times on the same file
 * without waiting for the callback.
 * @param fd
 * @param buffer Uint8Array containing the data to write to
 *   the file.
 * @param offset Offset in the buffer to start reading data from.
 * @param length The amount of bytes to write to the file.
 * @param position Offset from the beginning of the file where this
 *   data should be written. If position is null, the data will be written at
 *   the current position.
 * @param callback The number specifies the number of bytes written into the file.
 */
export function write(fd: number, buffer: Uint8Array, offset: number, length: number, cb?: ThreeArgCallback<number, Uint8Array>): void;
export function write(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, cb?: ThreeArgCallback<number, Uint8Array>): void;
export function write(fd: number, data: FileContents, cb?: ThreeArgCallback<number, string>): void;
export function write(fd: number, data: FileContents, position: number | null, cb?: ThreeArgCallback<number, string>): void;
export function write(fd: number, data: FileContents, position: number | null, encoding: BufferEncoding, cb?: ThreeArgCallback<number, string>): void;
export function write(fd: number, arg2: FileContents, arg3?: any, arg4?: any, arg5?: any, cb: ThreeArgCallback<number, Uint8Array> | ThreeArgCallback<number, string> = nop): void {
	let buffer: Uint8Array,
		offset: number,
		length: number,
		position: number | null = null,
		encoding: BufferEncoding;
	const handle = new promises.FileHandle(fd);
	if (typeof arg2 === 'string') {
		// Signature 1: (fd, string, [position?, [encoding?]], cb?)
		encoding = 'utf8';
		switch (typeof arg3) {
			case 'function':
				// (fd, string, cb)
				cb = arg3;
				break;
			case 'number':
				// (fd, string, position, encoding?, cb?)
				position = arg3;
				encoding = (typeof arg4 === 'string' ? arg4 : 'utf8') as BufferEncoding;
				cb = typeof arg5 === 'function' ? arg5 : cb;
				break;
			default:
				// ...try to find the callback and get out of here!
				cb = typeof arg4 === 'function' ? arg4 : typeof arg5 === 'function' ? arg5 : cb;
				cb(new ApiError(ErrorCode.EINVAL, 'Invalid arguments.'));
				return;
		}
		buffer = encode(arg2);
		offset = 0;
		length = buffer.length;

		const _cb = <ThreeArgCallback<number, string>>cb;

		handle
			.write(buffer, offset, length, position)
			.then(({ bytesWritten }) => _cb(null, bytesWritten, decode(buffer)))
			.catch(_cb);
	} else {
		// Signature 2: (fd, buffer, offset, length, position?, cb?)
		buffer = arg2;
		offset = arg3;
		length = arg4;
		position = typeof arg5 === 'number' ? arg5 : null;
		const _cb = <ThreeArgCallback<number, Uint8Array>>(typeof arg5 === 'function' ? arg5 : cb);
		handle
			.write(buffer, offset, length, position)
			.then(({ bytesWritten }) => _cb(null, bytesWritten, buffer))
			.catch(_cb);
	}
}
write satisfies Omit<typeof Node.write, '__promisify__'>;

/**
 * Read data from the file specified by `fd`.
 * @param buffer The buffer that the data will be
 *   written to.
 * @param offset The offset within the buffer where writing will
 *   start.
 * @param length An integer specifying the number of bytes to read.
 * @param position An integer specifying where to begin reading from
 *   in the file. If position is null, data will be read from the current file
 *   position.
 * @param callback The number is the number of bytes read
 */
export function read(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number, cb: ThreeArgCallback<number, Uint8Array> = nop): void {
	new promises.FileHandle(fd)
		.read(buffer, offset, length, position)
		.then(({ bytesRead, buffer }) => cb(null, bytesRead, buffer))
		.catch(cb);
}
read satisfies Omit<typeof Node.read, '__promisify__'>;

/**
 * Asynchronous `fchown`.
 * @param fd
 * @param uid
 * @param gid
 * @param callback
 */
export function fchown(fd: number, uid: number, gid: number, cb: NoArgCallback = nop): void {
	new promises.FileHandle(fd)
		.chown(uid, gid)
		.then(() => cb())
		.catch(cb);
}
fchown satisfies Omit<typeof Node.fchown, '__promisify__'>;

/**
 * Asynchronous `fchmod`.
 * @param fd
 * @param mode
 * @param callback
 */
export function fchmod(fd: number, mode: string | number, cb: NoArgCallback): void {
	new promises.FileHandle(fd)
		.chmod(mode)
		.then(() => cb())
		.catch(cb);
}
fchmod satisfies Omit<typeof Node.fchmod, '__promisify__'>;

/**
 * Change the file timestamps of a file referenced by the supplied file
 * descriptor.
 * @param fd
 * @param atime
 * @param mtime
 * @param callback
 */
export function futimes(fd: number, atime: number | Date, mtime: number | Date, cb: NoArgCallback = nop): void {
	new promises.FileHandle(fd)
		.utimes(atime, mtime)
		.then(() => cb())
		.catch(cb);
}
futimes satisfies Omit<typeof Node.futimes, '__promisify__'>;

/**
 * Asynchronous `rmdir`.
 * @param path
 * @param callback
 */
export function rmdir(path: PathLike, cb: NoArgCallback = nop): void {
	promises
		.rmdir(path)
		.then(() => cb())
		.catch(cb);
}
rmdir satisfies Omit<typeof Node.rmdir, '__promisify__'>;

/**
 * Asynchronous `mkdir`.
 * @param path
 * @param mode defaults to `0777`
 * @param callback
 */
export function mkdir(path: PathLike, mode?: Node.Mode, cb: NoArgCallback = nop): void {
	promises
		.mkdir(path, mode)
		.then(() => cb())
		.catch(cb);
}
mkdir satisfies Omit<typeof Node.mkdir, '__promisify__'>;

/**
 * Asynchronous `readdir`. Reads the contents of a directory.
 * The callback gets two arguments `(err, files)` where `files` is an array of
 * the names of the files in the directory excluding `'.'` and `'..'`.
 * @param path
 * @param callback
 */
export function readdir(path: PathLike, cb: TwoArgCallback<string[]>): void;
export function readdir(path: PathLike, options: { withFileTypes?: false }, cb: TwoArgCallback<string[]>): void;
export function readdir(path: PathLike, options: { withFileTypes: true }, cb: TwoArgCallback<Dirent[]>): void;
export function readdir(path: PathLike, _options: { withFileTypes?: boolean } | TwoArgCallback<string[]>, cb: TwoArgCallback<string[]> | TwoArgCallback<Dirent[]> = nop): void {
	cb = typeof _options == 'function' ? _options : cb;
	const options = typeof _options != 'function' ? _options : {};
	promises
		.readdir(path, options as object)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.then(entries => cb(null, entries as any))
		.catch(cb);
}
readdir satisfies Omit<typeof Node.readdir, '__promisify__'>;

/**
 * Asynchronous `link`.
 * @param srcpath
 * @param dstpath
 * @param callback
 */
export function link(srcpath: PathLike, dstpath: PathLike, cb: NoArgCallback = nop): void {
	promises
		.link(srcpath, dstpath)
		.then(() => cb())
		.catch(cb);
}
link satisfies Omit<typeof Node.link, '__promisify__'>;

/**
 * Asynchronous `symlink`.
 * @param srcpath
 * @param dstpath
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 * @param callback
 */
export function symlink(srcpath: PathLike, dstpath: PathLike, cb?: NoArgCallback): void;
export function symlink(srcpath: PathLike, dstpath: PathLike, type?: Node.symlink.Type, cb?: NoArgCallback): void;
export function symlink(srcpath: PathLike, dstpath: PathLike, arg3?: Node.symlink.Type | NoArgCallback, cb: NoArgCallback = nop): void {
	const type = typeof arg3 === 'string' ? arg3 : 'file';
	cb = typeof arg3 === 'function' ? arg3 : cb;
	promises
		.symlink(srcpath, dstpath, typeof arg3 === 'function' ? null : arg3)
		.then(() => cb())
		.catch(cb);
}
symlink satisfies Omit<typeof Node.symlink, '__promisify__'>;

/**
 * Asynchronous readlink.
 * @param path
 * @param callback
 */
export function readlink(path: PathLike, callback: TwoArgCallback<string> & any): void;
export function readlink(path: PathLike, options: Node.BufferEncodingOption, callback: TwoArgCallback<Uint8Array>): void;
export function readlink(path: PathLike, options: Node.BaseEncodingOptions | string, callback: TwoArgCallback<string | Uint8Array>): void;
export function readlink(path: PathLike, options: Node.BaseEncodingOptions | BufferEncoding, callback: TwoArgCallback<string>): void;
export function readlink(
	path: PathLike,
	options: Node.BufferEncodingOption | Node.BaseEncodingOptions | string | TwoArgCallback<string>,
	callback: TwoArgCallback<string> | TwoArgCallback<Uint8Array> = nop
): void {
	callback = typeof options == 'function' ? options : callback;
	promises
		.readlink(path)
		.then(result => callback(null, result as string & Uint8Array))
		.catch(callback);
}
readlink satisfies Omit<typeof Node.readlink, '__promisify__'>;

/**
 * Asynchronous `chown`.
 * @param path
 * @param uid
 * @param gid
 * @param callback
 */
export function chown(path: PathLike, uid: number, gid: number, cb: NoArgCallback = nop): void {
	promises
		.chown(path, uid, gid)
		.then(() => cb())
		.catch(cb);
}
chown satisfies Omit<typeof Node.chown, '__promisify__'>;

/**
 * Asynchronous `lchown`.
 * @param path
 * @param uid
 * @param gid
 * @param callback
 */
export function lchown(path: PathLike, uid: number, gid: number, cb: NoArgCallback = nop): void {
	promises
		.lchown(path, uid, gid)
		.then(() => cb())
		.catch(cb);
}
lchown satisfies Omit<typeof Node.lchown, '__promisify__'>;

/**
 * Asynchronous `chmod`.
 * @param path
 * @param mode
 * @param callback
 */
export function chmod(path: PathLike, mode: number | string, cb: NoArgCallback = nop): void {
	promises
		.chmod(path, mode)
		.then(() => cb())
		.catch(cb);
}
chmod satisfies Omit<typeof Node.chmod, '__promisify__'>;

/**
 * Asynchronous `lchmod`.
 * @param path
 * @param mode
 * @param callback
 */
export function lchmod(path: PathLike, mode: number | string, cb: NoArgCallback = nop): void {
	promises
		.lchmod(path, mode)
		.then(() => cb())
		.catch(cb);
}
lchmod satisfies Omit<typeof Node.lchmod, '__promisify__'>;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 * @param callback
 */
export function utimes(path: PathLike, atime: number | Date, mtime: number | Date, cb: NoArgCallback = nop): void {
	promises
		.utimes(path, atime, mtime)
		.then(() => cb())
		.catch(cb);
}
utimes satisfies Omit<typeof Node.utimes, '__promisify__'>;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 * @param callback
 */
export function lutimes(path: PathLike, atime: number | Date, mtime: number | Date, cb: NoArgCallback = nop): void {
	promises
		.lutimes(path, atime, mtime)
		.then(() => cb())
		.catch(cb);
}
lutimes satisfies Omit<typeof Node.lutimes, '__promisify__'>;

/**
 * Asynchronous `realpath`. The callback gets two arguments
 * `(err, resolvedPath)`. May use `process.cwd` to resolve relative paths.
 *
 * @example Usage example
 *   fs.realpath('/etc/passwd', function (err, resolvedPath) {
 *     if (err) throw err;
 *     console.log(resolvedPath);
 *   });
 *
 * @param path
 * @param callback
 */
export function realpath(path: PathLike, cb?: TwoArgCallback<string>): void;
export function realpath(path: PathLike, options: Node.BaseEncodingOptions, cb: TwoArgCallback<string>): void;
export function realpath(path: PathLike, arg2?: TwoArgCallback<string> | Node.BaseEncodingOptions, cb: TwoArgCallback<string> = nop): void {
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises
		.realpath(path, typeof arg2 === 'function' ? null : arg2)
		.then(result => cb(null, result))
		.catch(cb);
}
realpath satisfies Omit<typeof Node.realpath, '__promisify__' | 'native'>;

/**
 * Asynchronous `access`.
 * @param path
 * @param mode
 * @param callback
 */
export function access(path: PathLike, cb: NoArgCallback): void;
export function access(path: PathLike, mode: number, cb: NoArgCallback): void;
export function access(path: PathLike, arg2: any, cb: NoArgCallback = nop): void {
	const mode = typeof arg2 === 'number' ? arg2 : R_OK;
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises
		.access(path, typeof arg2 === 'function' ? null : arg2)
		.then(() => cb())
		.catch(cb);
}
access satisfies Omit<typeof Node.access, '__promisify__'>;

export function watchFile(filename: PathLike, listener: (curr: Stats, prev: Stats) => void): void;
export function watchFile(filename: PathLike, options: { persistent?: boolean; interval?: number }, listener: (curr: Stats, prev: Stats) => void): void;
export function watchFile(filename: PathLike, arg2: any, listener: (curr: Stats, prev: Stats) => void = nop): void {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function unwatchFile(filename: PathLike, listener: (curr: Stats, prev: Stats) => void = nop): void {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function watch(filename: PathLike, listener?: (event: string, filename: string) => any): Node.FSWatcher;
export function watch(filename: PathLike, options: { persistent?: boolean }, listener?: (event: string, filename: string) => any): Node.FSWatcher;
export function watch(filename: PathLike, arg2: any, listener: (event: string, filename: string) => any = nop): Node.FSWatcher {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function createReadStream(
	path: PathLike,
	options?: {
		flags?: string;
		encoding?: string;
		fd?: number;
		mode?: number;
		autoClose?: boolean;
	}
): ReadStream {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function createWriteStream(
	path: PathLike,
	options?: {
		flags?: string;
		encoding?: string;
		fd?: number;
		mode?: number;
	}
): WriteStream {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function rm(path: PathLike) {
	new ApiError(ErrorCode.ENOTSUP);
}

export function mkdtemp(path: PathLike) {
	new ApiError(ErrorCode.ENOTSUP);
}

export function copyFile(src: PathLike, dest: PathLike, callback: NoArgCallback): void;
export function copyFile(src: PathLike, dest: PathLike, flags: number, callback: NoArgCallback): void;
export function copyFile(src: PathLike, dest: PathLike, flags: number | NoArgCallback, callback?: NoArgCallback): void {
	new ApiError(ErrorCode.ENOTSUP);
}

export function readv(path: PathLike) {
	new ApiError(ErrorCode.ENOTSUP);
}

type writevCallback = ThreeArgCallback<number, Uint8Array[]>;

export function writev(fd: number, buffers: Uint8Array[], cb: writevCallback): void;
export function writev(fd: number, buffers: Uint8Array[], position: number, cb: writevCallback): void;
export function writev(fd: number, buffers: Uint8Array[], position: number | writevCallback, cb?: writevCallback) {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function opendir(path: PathLike) {
	throw new ApiError(ErrorCode.ENOTSUP);
}
