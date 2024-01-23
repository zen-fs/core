import type { FSWatcher, StatOptions, symlink as _symlink } from 'fs';
import { ApiError, ErrorCode } from '../ApiError.js';
import { TwoArgCallback, NoArgCallback, ThreeArgCallback, FileContents } from '../filesystem.js';
import { BigIntStats, Stats } from '../stats.js';
import { nop, normalizeMode } from './shared.js';
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
export function rename(oldPath: string, newPath: string, cb: NoArgCallback = nop): void {
	promises
		.rename(oldPath, newPath)
		.then(() => cb())
		.catch(cb);
}

/**
 * Test whether or not the given path exists by checking with the file system.
 * Then call the callback argument with either true or false.
 * @example Sample invocation
 *   fs.exists('/etc/passwd', function (exists) {
 *     util.debug(exists ? "it's there" : "no passwd!");
 *   });
 * @param path
 * @param callback
 */
export function exists(path: string, cb: (exists: boolean) => unknown = nop): void {
	promises
		.exists(path)
		.then(cb)
		.catch(() => cb(false));
}

/**
 * Asynchronous `stat`.
 * @param path
 * @param callback
 */
export function stat(path: string, callback: TwoArgCallback<Stats>): void;
export function stat(path: string, options: StatOptions & { bigint?: false }, callback: TwoArgCallback<Stats>): void;
export function stat(path: string, options: StatOptions & { bigint: true }, callback: TwoArgCallback<BigIntStats>): void;
export function stat(path: string, options: StatOptions, callback: TwoArgCallback<Stats | BigIntStats>): void;
export function stat(path: string, options?: StatOptions | TwoArgCallback<Stats>, callback: TwoArgCallback<Stats> | TwoArgCallback<BigIntStats> = nop): void {
	callback = typeof options == 'function' ? options : callback;
	promises
		.stat(path, typeof options != 'function' ? options : ({} as object))
		.then(stats => callback(null, stats as Stats & BigIntStats))
		.catch(callback);
}

/**
 * Asynchronous `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 * @param callback
 */
export function lstat(path: string, callback: TwoArgCallback<Stats>): void;
export function lstat(path: string, options: StatOptions & { bigint?: false }, callback: TwoArgCallback<Stats>): void;
export function lstat(path: string, options: StatOptions & { bigint: true }, callback: TwoArgCallback<BigIntStats>): void;
export function lstat(path: string, options: StatOptions, callback: TwoArgCallback<Stats | BigIntStats>): void;
export function lstat(path: string, options?: StatOptions | TwoArgCallback<Stats>, callback: TwoArgCallback<Stats> | TwoArgCallback<BigIntStats> = nop): void {
	callback = typeof options == 'function' ? options : callback;
	promises
		.lstat(path, typeof options != 'function' ? options : ({} as object))
		.then(stats => callback(null, stats as Stats & BigIntStats))
		.catch(callback);
}

/**
 * Asynchronous `truncate`.
 * @param path
 * @param len
 * @param callback
 */
export function truncate(path: string, cb?: NoArgCallback): void;
export function truncate(path: string, len: number, cb?: NoArgCallback): void;
export function truncate(path: string, arg2: number | NoArgCallback = 0, cb: NoArgCallback = nop): void {
	cb = typeof arg2 === 'function' ? arg2 : cb;
	const len = typeof arg2 === 'number' ? arg2 : 0;
	promises
		.truncate(path, len)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `unlink`.
 * @param path
 * @param callback
 */
export function unlink(path: string, cb: NoArgCallback = nop): void {
	promises
		.unlink(path)
		.then(() => cb())
		.catch(cb);
}

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
export function open(path: string, flag: string, cb?: TwoArgCallback<number>): void;
export function open(path: string, flag: string, mode: number | string, cb?: TwoArgCallback<number>): void;
export function open(path: string, flag: string, arg2?: number | string | TwoArgCallback<number>, cb: TwoArgCallback<number> = nop): void {
	const mode = normalizeMode(arg2, 0o644);
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises
		.open(path, flag, mode)
		.then(fd => cb(null, fd))
		.catch(cb);
}

/**
 * Asynchronously reads the entire contents of a file.
 * @example Usage example
 *   fs.readFile('/etc/passwd', function (err, data) {
 *     if (err) throw err;
 *     console.log(data);
 *   });
 * @param filename
 * @param options
 * @option options [String] encoding The string encoding for the file contents. Defaults to `null`.
 * @option options [String] flag Defaults to `'r'`.
 * @param callback If no encoding is specified, then the raw buffer is returned.
 */
export function readFile(filename: string, cb: TwoArgCallback<Uint8Array>): void;
export function readFile(filename: string, options: { flag?: string }, callback?: TwoArgCallback<Uint8Array>): void;
export function readFile(filename: string, options: { encoding: string; flag?: string }, callback?: TwoArgCallback<string>): void;
export function readFile(filename: string, encoding: string, cb: TwoArgCallback<string>): void;
export function readFile(filename: string, arg2: any = {}, cb: TwoArgCallback<string> | TwoArgCallback<Uint8Array> = nop) {
	cb = typeof arg2 === 'function' ? arg2 : cb;

	promises.readFile(filename, typeof arg2 === 'function' ? null : arg2);
}

/**
 * Asynchronously writes data to a file, replacing the file if it already
 * exists.
 *
 * The encoding option is ignored if data is a buffer.
 *
 * @example Usage example
 *   fs.writeFile('message.txt', 'Hello Node', function (err) {
 *     if (err) throw err;
 *     console.log('It\'s saved!');
 *   });
 * @param filename
 * @param data
 * @param options
 * @option options [String] encoding Defaults to `'utf8'`.
 * @option options [Number] mode Defaults to `0644`.
 * @option options [String] flag Defaults to `'w'`.
 * @param callback
 */
export function writeFile(filename: string, data: FileContents, cb?: NoArgCallback): void;
export function writeFile(filename: string, data: FileContents, encoding?: string, cb?: NoArgCallback): void;
export function writeFile(filename: string, data: FileContents, options?: { encoding?: string; mode?: string | number; flag?: string }, cb?: NoArgCallback): void;
export function writeFile(
	filename: string,
	data: FileContents,
	arg3: { encoding?: string; mode?: string | number; flag?: string } | string | NoArgCallback = {},
	cb: NoArgCallback = nop
): void {
	cb = typeof arg3 === 'function' ? arg3 : cb;
	promises.writeFile(filename, data, typeof arg3 === 'function' ? undefined : arg3);
}

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
 * @option options [String] encoding Defaults to `'utf8'`.
 * @option options [Number] mode Defaults to `0644`.
 * @option options [String] flag Defaults to `'a'`.
 * @param callback
 */
export function appendFile(filename: string, data: FileContents, cb?: NoArgCallback): void;
export function appendFile(filename: string, data: FileContents, options?: { encoding?: string; mode?: number | string; flag?: string }, cb?: NoArgCallback): void;
export function appendFile(filename: string, data: FileContents, encoding?: string, cb?: NoArgCallback): void;
export function appendFile(filename: string, data: FileContents, arg3?: any, cb: NoArgCallback = nop): void {
	cb = typeof arg3 === 'function' ? arg3 : cb;
	promises.appendFile(filename, data, typeof arg3 === 'function' ? null : arg3);
}

/**
 * Asynchronous `fstat`.
 * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
 * specified by the file descriptor `fd`.
 * @param fd
 * @param callback
 */
export function fstat(fd: number, cb: TwoArgCallback<Stats>): void;
export function fstat(fd: number, options: StatOptions & { bigint?: false }, cb: TwoArgCallback<Stats>): void;
export function fstat(fd: number, options: StatOptions & { bigint: true }, cb: TwoArgCallback<BigIntStats>): void;
export function fstat(fd: number, options: StatOptions, cb: TwoArgCallback<Stats | BigIntStats>): void;
export function fstat(fd: number, options?: StatOptions | TwoArgCallback<Stats>, cb: TwoArgCallback<Stats> | TwoArgCallback<BigIntStats> = nop): void {
	cb = typeof options == 'function' ? options : cb;
	promises
		.fstat(fd, typeof options != 'function' ? options : ({} as object))
		.then(stats => cb(null, stats as Stats & BigIntStats))
		.catch(cb);
}

/**
 * Asynchronous close.
 * @param fd
 * @param callback
 */
export function close(fd: number, cb: NoArgCallback = nop): void {
	promises
		.close(fd)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous ftruncate.
 * @param fd
 * @param len
 * @param callback
 */
export function ftruncate(fd: number, cb?: NoArgCallback): void;
export function ftruncate(fd: number, len?: number, cb?: NoArgCallback): void;
export function ftruncate(fd: number, arg2?: any, cb: NoArgCallback = nop): void {
	const length = typeof arg2 === 'number' ? arg2 : 0;
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises.ftruncate(fd, length);
}

/**
 * Asynchronous fsync.
 * @param fd
 * @param callback
 */
export function fsync(fd: number, cb: NoArgCallback = nop): void {
	promises
		.fsync(fd)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous fdatasync.
 * @param fd
 * @param callback
 */
export function fdatasync(fd: number, cb: NoArgCallback = nop): void {
	promises
		.fdatasync(fd)
		.then(() => cb())
		.catch(cb);
}

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
		const _cb = cb as ThreeArgCallback<number, string>;
		promises
			.write(fd, buffer, offset, length, position)
			.then(bytesWritten => _cb(null, bytesWritten, decode(buffer)))
			.catch(_cb);
	} else {
		// Signature 2: (fd, buffer, offset, length, position?, cb?)
		buffer = arg2;
		offset = arg3;
		length = arg4;
		position = typeof arg5 === 'number' ? arg5 : null;
		const _cb = (typeof arg5 === 'function' ? arg5 : cb) as ThreeArgCallback<number, Uint8Array>;
		promises
			.write(fd, buffer, offset, length, position)
			.then(bytesWritten => _cb(null, bytesWritten, buffer))
			.catch(_cb);
	}
}

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
	promises
		.read(fd, buffer, offset, length, position)
		.then(({ bytesRead, buffer }) => cb(null, bytesRead, buffer))
		.catch(cb);
}

/**
 * Asynchronous `fchown`.
 * @param fd
 * @param uid
 * @param gid
 * @param callback
 */
export function fchown(fd: number, uid: number, gid: number, cb: NoArgCallback = nop): void {
	promises
		.fchown(fd, uid, gid)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `fchmod`.
 * @param fd
 * @param mode
 * @param callback
 */
export function fchmod(fd: number, mode: string | number, cb: NoArgCallback): void {
	promises
		.fchmod(fd, mode)
		.then(() => cb())
		.catch(cb);
}

/**
 * Change the file timestamps of a file referenced by the supplied file
 * descriptor.
 * @param fd
 * @param atime
 * @param mtime
 * @param callback
 */
export function futimes(fd: number, atime: number | Date, mtime: number | Date, cb: NoArgCallback = nop): void {
	promises
		.futimes(fd, atime, mtime)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `rmdir`.
 * @param path
 * @param callback
 */
export function rmdir(path: string, cb: NoArgCallback = nop): void {
	promises
		.rmdir(path)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `mkdir`.
 * @param path
 * @param mode defaults to `0777`
 * @param callback
 */
export function mkdir(path: string, mode?: any, cb: NoArgCallback = nop): void {
	promises
		.mkdir(path, mode)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `readdir`. Reads the contents of a directory.
 * The callback gets two arguments `(err, files)` where `files` is an array of
 * the names of the files in the directory excluding `'.'` and `'..'`.
 * @param path
 * @param callback
 */
export function readdir(path: string, cb: TwoArgCallback<string[]>): void;
export function readdir(path: string, options: { withFileTypes?: false }, cb: TwoArgCallback<string[]>): void;
export function readdir(path: string, options: { withFileTypes: true }, cb: TwoArgCallback<Dirent[]>): void;
export function readdir(path: string, _options: { withFileTypes?: boolean } | TwoArgCallback<string[]>, cb: TwoArgCallback<string[]> | TwoArgCallback<Dirent[]> = nop): void {
	cb = typeof _options == 'function' ? _options : cb;
	const options = typeof _options != 'function' ? _options : {};
	promises
		.readdir(path, options as object)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.then(entries => cb(null, entries as any))
		.catch(cb);
}

/**
 * Asynchronous `link`.
 * @param srcpath
 * @param dstpath
 * @param callback
 */
export function link(srcpath: string, dstpath: string, cb: NoArgCallback = nop): void {
	promises
		.link(srcpath, dstpath)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `symlink`.
 * @param srcpath
 * @param dstpath
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 * @param callback
 */
export function symlink(srcpath: string, dstpath: string, cb?: NoArgCallback): void;
export function symlink(srcpath: string, dstpath: string, type?: _symlink.Type, cb?: NoArgCallback): void;
export function symlink(srcpath: string, dstpath: string, arg3?: _symlink.Type | NoArgCallback, cb: NoArgCallback = nop): void {
	const type = typeof arg3 === 'string' ? arg3 : 'file';
	cb = typeof arg3 === 'function' ? arg3 : cb;
	promises
		.symlink(srcpath, dstpath, typeof arg3 === 'function' ? null : arg3)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous readlink.
 * @param path
 * @param callback
 */
export function readlink(path: string, cb: TwoArgCallback<string> = nop): void {
	promises
		.readlink(path)
		.then(result => cb(null, result))
		.catch(cb);
}

/**
 * Asynchronous `chown`.
 * @param path
 * @param uid
 * @param gid
 * @param callback
 */
export function chown(path: string, uid: number, gid: number, cb: NoArgCallback = nop): void {
	promises
		.chown(path, uid, gid)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `lchown`.
 * @param path
 * @param uid
 * @param gid
 * @param callback
 */
export function lchown(path: string, uid: number, gid: number, cb: NoArgCallback = nop): void {
	promises
		.lchown(path, uid, gid)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `chmod`.
 * @param path
 * @param mode
 * @param callback
 */
export function chmod(path: string, mode: number | string, cb: NoArgCallback = nop): void {
	promises
		.chmod(path, mode)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `lchmod`.
 * @param path
 * @param mode
 * @param callback
 */
export function lchmod(path: string, mode: number | string, cb: NoArgCallback = nop): void {
	promises
		.lchmod(path, mode)
		.then(() => cb())
		.catch(cb);
}

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 * @param callback
 */
export function utimes(path: string, atime: number | Date, mtime: number | Date, cb: NoArgCallback = nop): void {
	promises
		.utimes(path, atime, mtime)
		.then(() => cb())
		.catch(cb);
}

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 * @param callback
 */
export function lutimes(path: string, atime: number | Date, mtime: number | Date, cb: NoArgCallback = nop): void {
	promises
		.lutimes(path, atime, mtime)
		.then(() => cb())
		.catch(cb);
}

/**
 * Asynchronous `realpath`. The callback gets two arguments
 * `(err, resolvedPath)`. May use `process.cwd` to resolve relative paths.
 *
 * @example Usage example
 *   let cache = {'/etc':'/private/etc'};
 *   fs.realpath('/etc/passwd', cache, function (err, resolvedPath) {
 *     if (err) throw err;
 *     console.log(resolvedPath);
 *   });
 *
 * @param path
 * @param cache An object literal of mapped paths that can be used to
 *   force a specific path resolution or avoid additional `fs.stat` calls for
 *   known real paths.
 * @param callback
 */
export function realpath(path: string, cb?: TwoArgCallback<string>): void;
export function realpath(path: string, cache: { [path: string]: string }, cb: TwoArgCallback<string>): void;
export function realpath(path: string, arg2?: any, cb: TwoArgCallback<string> = nop): void {
	const cache = typeof arg2 === 'object' ? arg2 : {};
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises
		.realpath(path, typeof arg2 === 'function' ? null : arg2)
		.then(result => cb(null, result))
		.catch(cb);
}

/**
 * Asynchronous `access`.
 * @param path
 * @param mode
 * @param callback
 */
export function access(path: string, cb: NoArgCallback): void;
export function access(path: string, mode: number, cb: NoArgCallback): void;
export function access(path: string, arg2: any, cb: NoArgCallback = nop): void {
	const mode = typeof arg2 === 'number' ? arg2 : R_OK;
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises
		.access(path, typeof arg2 === 'function' ? null : arg2)
		.then(() => cb())
		.catch(cb);
}

export function watchFile(filename: string, listener: (curr: Stats, prev: Stats) => void): void;
export function watchFile(filename: string, options: { persistent?: boolean; interval?: number }, listener: (curr: Stats, prev: Stats) => void): void;
export function watchFile(filename: string, arg2: any, listener: (curr: Stats, prev: Stats) => void = nop): void {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function unwatchFile(filename: string, listener: (curr: Stats, prev: Stats) => void = nop): void {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function watch(filename: string, listener?: (event: string, filename: string) => any): FSWatcher;
export function watch(filename: string, options: { persistent?: boolean }, listener?: (event: string, filename: string) => any): FSWatcher;
export function watch(filename: string, arg2: any, listener: (event: string, filename: string) => any = nop): FSWatcher {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function createReadStream(
	path: string,
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
	path: string,
	options?: {
		flags?: string;
		encoding?: string;
		fd?: number;
		mode?: number;
	}
): WriteStream {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function rm(path: string) {
	new ApiError(ErrorCode.ENOTSUP);
}

export function mkdtemp(path: string) {
	new ApiError(ErrorCode.ENOTSUP);
}

export function copyFile(src: string, dest: string, callback: NoArgCallback): void;
export function copyFile(src: string, dest: string, flags: number, callback: NoArgCallback): void;
export function copyFile(src: string, dest: string, flags: number | NoArgCallback, callback?: NoArgCallback): void {
	new ApiError(ErrorCode.ENOTSUP);
}

export function readv(path: string) {
	new ApiError(ErrorCode.ENOTSUP);
}

type writevCallback = ThreeArgCallback<number, Uint8Array[]>;

export function writev(fd: number, buffers: Uint8Array[], cb: writevCallback): void;
export function writev(fd: number, buffers: Uint8Array[], position: number, cb: writevCallback): void;
export function writev(fd: number, buffers: Uint8Array[], position: number | writevCallback, cb?: writevCallback) {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export function opendir(path: string) {
	throw new ApiError(ErrorCode.ENOTSUP);
}
