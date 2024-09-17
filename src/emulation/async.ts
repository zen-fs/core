import { Buffer } from 'buffer';
import type * as fs from 'node:fs';
import { Errno, ErrnoError } from '../error.js';
import type { FileContents } from '../filesystem.js';
import { BigIntStats, type Stats } from '../stats.js';
import { normalizeMode, normalizePath, type Callback } from '../utils.js';
import { R_OK } from './constants.js';
import type { Dirent } from './dir.js';
import type { Dir } from './dir.js';
import * as promises from './promises.js';
import { fd2file } from './shared.js';
import { ReadStream, WriteStream } from './streams.js';
import { FSWatcher, StatWatcher } from './watchers.js';

const nop = () => {};

/**
 * Asynchronous rename. No arguments other than a possible exception are given
 * to the completion callback.
 * @param oldPath
 * @param newPath
 * @param callback
 */
export function rename(oldPath: fs.PathLike, newPath: fs.PathLike, cb: Callback = nop): void {
	promises
		.rename(oldPath, newPath)
		.then(() => cb())
		.catch(cb);
}
rename satisfies Omit<typeof fs.rename, '__promisify__'>;

/**
 * Test whether or not the given path exists by checking with the file system.
 * Then call the callback argument with either true or false.
 * @param path
 * @param callback
 * @deprecated Use {@link stat} or {@link access} instead.
 */
export function exists(path: fs.PathLike, cb: (exists: boolean) => unknown = nop): void {
	promises
		.exists(path)
		.then(cb)
		.catch(() => cb(false));
}
exists satisfies Omit<typeof fs.exists, '__promisify__'>;

/**
 * Asynchronous `stat`.
 * @param path
 * @param callback
 */
export function stat(path: fs.PathLike, callback: Callback<[Stats]>): void;
export function stat(path: fs.PathLike, options: { bigint?: false }, callback: Callback<[Stats]>): void;
export function stat(path: fs.PathLike, options: { bigint: true }, callback: Callback<[BigIntStats]>): void;
export function stat(path: fs.PathLike, options: fs.StatOptions, callback: Callback<[Stats] | [BigIntStats]>): void;
export function stat(path: fs.PathLike, options?: fs.StatOptions | Callback<[Stats]>, callback: Callback<[Stats]> | Callback<[BigIntStats]> = nop): void {
	callback = typeof options == 'function' ? options : callback;
	promises
		.stat(path, typeof options != 'function' ? options : {})
		.then(stats => (callback as Callback<[Stats] | [BigIntStats]>)(undefined, stats as any))
		.catch(callback);
}
stat satisfies Omit<typeof fs.stat, '__promisify__'>;

/**
 * Asynchronous `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 * @param callback
 */
export function lstat(path: fs.PathLike, callback: Callback<[Stats]>): void;
export function lstat(path: fs.PathLike, options: fs.StatOptions & { bigint?: false }, callback: Callback<[Stats]>): void;
export function lstat(path: fs.PathLike, options: fs.StatOptions & { bigint: true }, callback: Callback<[BigIntStats]>): void;
export function lstat(path: fs.PathLike, options: fs.StatOptions, callback: Callback<[Stats | BigIntStats]>): void;
export function lstat(path: fs.PathLike, options?: fs.StatOptions | Callback<[Stats]>, callback: Callback<[Stats]> | Callback<[BigIntStats]> = nop): void {
	callback = typeof options == 'function' ? options : callback;
	promises
		.lstat(path, typeof options != 'function' ? options : ({} as object))
		.then(stats => (callback as Callback<[Stats] | [BigIntStats]>)(undefined, stats))
		.catch(callback);
}
lstat satisfies Omit<typeof fs.lstat, '__promisify__'>;

/**
 * Asynchronous `truncate`.
 * @param path
 * @param len
 * @param callback
 */
export function truncate(path: fs.PathLike, cb?: Callback): void;
export function truncate(path: fs.PathLike, len: number, cb?: Callback): void;
export function truncate(path: fs.PathLike, cbLen: number | Callback = 0, cb: Callback = nop): void {
	cb = typeof cbLen === 'function' ? cbLen : cb;
	const len = typeof cbLen === 'number' ? cbLen : 0;
	promises
		.truncate(path, len)
		.then(() => cb())
		.catch(cb);
}
truncate satisfies Omit<typeof fs.truncate, '__promisify__'>;

/**
 * Asynchronous `unlink`.
 * @param path
 * @param callback
 */
export function unlink(path: fs.PathLike, cb: Callback = nop): void {
	promises
		.unlink(path)
		.then(() => cb())
		.catch(cb);
}
unlink satisfies Omit<typeof fs.unlink, '__promisify__'>;

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
export function open(path: fs.PathLike, flag: string, cb?: Callback<[number]>): void;
export function open(path: fs.PathLike, flag: string, mode: number | string, cb?: Callback<[number]>): void;
export function open(path: fs.PathLike, flag: string, cbMode?: number | string | Callback<[number]>, cb: Callback<[number]> = nop): void {
	const mode = normalizeMode(cbMode, 0o644);
	cb = typeof cbMode === 'function' ? cbMode : cb;
	promises
		.open(path, flag, mode)
		.then(handle => cb(undefined, handle.fd))
		.catch(cb);
}
open satisfies Omit<typeof fs.open, '__promisify__'>;

/**
 * Asynchronously reads the entire contents of a file.
 * @param filename
 * @param options
 * @option options encoding The string encoding for the file contents. Defaults to `null`.
 * @option options flag Defaults to `'r'`.
 * @param callback If no encoding is specified, then the raw buffer is returned.
 */
export function readFile(filename: fs.PathLike, cb: Callback<[Uint8Array]>): void;
export function readFile(filename: fs.PathLike, options: { flag?: string }, callback?: Callback<[Uint8Array]>): void;
export function readFile(filename: fs.PathLike, options: { encoding: BufferEncoding; flag?: string } | BufferEncoding, cb: Callback<[string]>): void;
export function readFile(filename: fs.PathLike, options?: fs.WriteFileOptions | BufferEncoding | Callback<[Uint8Array]>, cb: Callback<[string]> | Callback<[Uint8Array]> = nop) {
	cb = typeof options === 'function' ? options : cb;

	promises
		.readFile(filename, typeof options === 'function' ? null : options)
		.then(data => (cb as Callback<[string | Uint8Array]>)(undefined, data))
		.catch(cb);
}
readFile satisfies Omit<typeof fs.readFile, '__promisify__'>;

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
export function writeFile(filename: fs.PathLike, data: FileContents, cb?: Callback): void;
export function writeFile(filename: fs.PathLike, data: FileContents, encoding?: BufferEncoding, cb?: Callback): void;
export function writeFile(filename: fs.PathLike, data: FileContents, options?: fs.WriteFileOptions, cb?: Callback): void;
export function writeFile(filename: fs.PathLike, data: FileContents, cbEncOpts?: fs.WriteFileOptions | Callback, cb: Callback = nop): void {
	cb = typeof cbEncOpts === 'function' ? cbEncOpts : cb;
	promises
		.writeFile(filename, data, typeof cbEncOpts != 'function' ? cbEncOpts : null)
		.then(() => cb(undefined))
		.catch(cb);
}
writeFile satisfies Omit<typeof fs.writeFile, '__promisify__'>;

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
export function appendFile(filename: fs.PathLike, data: FileContents, cb?: Callback): void;
export function appendFile(filename: fs.PathLike, data: FileContents, options?: fs.EncodingOption & { mode?: fs.Mode; flag?: fs.OpenMode }, cb?: Callback): void;
export function appendFile(filename: fs.PathLike, data: FileContents, encoding?: BufferEncoding, cb?: Callback): void;
export function appendFile(
	filename: fs.PathLike,
	data: FileContents,
	cbEncOpts?: (fs.EncodingOption & { mode?: fs.Mode; flag?: fs.OpenMode }) | Callback,
	cb: Callback = nop
): void {
	const optionsOrEncoding = typeof cbEncOpts != 'function' ? cbEncOpts : undefined;
	cb = typeof cbEncOpts === 'function' ? cbEncOpts : cb;
	promises
		.appendFile(filename, data, optionsOrEncoding)
		.then(() => cb())
		.catch(cb);
}
appendFile satisfies Omit<typeof fs.appendFile, '__promisify__'>;

/**
 * Asynchronous `fstat`.
 * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
 * specified by the file descriptor `fd`.
 * @param fd
 * @param callback
 */
export function fstat(fd: number, cb: Callback<[Stats]>): void;
export function fstat(fd: number, options: fs.StatOptions & { bigint?: false }, cb: Callback<[Stats]>): void;
export function fstat(fd: number, options: fs.StatOptions & { bigint: true }, cb: Callback<[BigIntStats]>): void;
export function fstat(fd: number, options?: fs.StatOptions | Callback<[Stats]>, cb: Callback<[Stats]> | Callback<[BigIntStats]> = nop): void {
	cb = typeof options == 'function' ? options : cb;

	fd2file(fd)
		.stat()
		.then(stats => (cb as Callback<[Stats | BigIntStats]>)(undefined, typeof options == 'object' && options?.bigint ? new BigIntStats(stats) : stats))
		.catch(cb);
}
fstat satisfies Omit<typeof fs.fstat, '__promisify__'>;

/**
 * Asynchronous close.
 * @param fd
 * @param callback
 */
export function close(fd: number, cb: Callback = nop): void {
	new promises.FileHandle(fd)
		.close()
		.then(() => cb())
		.catch(cb);
}
close satisfies Omit<typeof fs.close, '__promisify__'>;

/**
 * Asynchronous ftruncate.
 * @param fd
 * @param len
 * @param callback
 */
export function ftruncate(fd: number, cb?: Callback): void;
export function ftruncate(fd: number, len?: number, cb?: Callback): void;
export function ftruncate(fd: number, lenOrCB?: number | Callback, cb: Callback = nop): void {
	const length = typeof lenOrCB === 'number' ? lenOrCB : 0;
	cb = typeof lenOrCB === 'function' ? lenOrCB : cb;
	const file = fd2file(fd);
	if (length < 0) {
		throw new ErrnoError(Errno.EINVAL);
	}
	file.truncate(length)
		.then(() => cb())
		.catch(cb);
}
ftruncate satisfies Omit<typeof fs.ftruncate, '__promisify__'>;

/**
 * Asynchronous fsync.
 * @param fd
 * @param callback
 */
export function fsync(fd: number, cb: Callback = nop): void {
	fd2file(fd)
		.sync()
		.then(() => cb())
		.catch(cb);
}
fsync satisfies Omit<typeof fs.fsync, '__promisify__'>;

/**
 * Asynchronous fdatasync.
 * @param fd
 * @param callback
 */
export function fdatasync(fd: number, cb: Callback = nop): void {
	fd2file(fd)
		.datasync()
		.then(() => cb())
		.catch(cb);
}
fdatasync satisfies Omit<typeof fs.fdatasync, '__promisify__'>;

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
export function write(fd: number, buffer: Uint8Array, offset: number, length: number, cb?: Callback<[number, Uint8Array]>): void;
export function write(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number, cb?: Callback<[number, Uint8Array]>): void;
export function write(fd: number, data: FileContents, cb?: Callback<[number, string]>): void;
export function write(fd: number, data: FileContents, position?: number, cb?: Callback<[number, string]>): void;
export function write(fd: number, data: FileContents, position: number | null, encoding: BufferEncoding, cb?: Callback<[number, string]>): void;
export function write(
	fd: number,
	data: FileContents,
	cbPosOff?: number | Callback<[number, string]> | null,
	cbLenEnc?: number | BufferEncoding | Callback<[number, string]>,
	cbPosEnc?: number | BufferEncoding | Callback<[number, Uint8Array]> | Callback<[number, string]>,
	cb: Callback<[number, Uint8Array]> | Callback<[number, string]> = nop
): void {
	let buffer: Buffer, offset: number | undefined, length: number | undefined, position: number | undefined | null, encoding: BufferEncoding;
	const handle = new promises.FileHandle(fd);
	if (typeof data === 'string') {
		// Signature 1: (fd, string, [position?, [encoding?]], cb?)
		encoding = 'utf8';
		switch (typeof cbPosOff) {
			case 'function':
				// (fd, string, cb)
				cb = cbPosOff;
				break;
			case 'number':
				// (fd, string, position, encoding?, cb?)
				position = cbPosOff;
				encoding = typeof cbLenEnc === 'string' ? cbLenEnc : 'utf8';
				cb = typeof cbPosEnc === 'function' ? cbPosEnc : cb;
				break;
			default:
				// ...try to find the callback and get out of here!
				cb = (typeof cbLenEnc === 'function' ? cbLenEnc : typeof cbPosEnc === 'function' ? cbPosEnc : cb) as Callback<[number, Uint8Array | string]>;
				(cb as Callback<[number, Uint8Array | string]>)(new ErrnoError(Errno.EINVAL, 'Invalid arguments.'));
				return;
		}
		buffer = Buffer.from(data);
		offset = 0;
		length = buffer.length;

		const _cb = cb as Callback<[number, string]>;

		handle
			.write(buffer, offset, length, position)
			.then(({ bytesWritten }) => _cb(undefined, bytesWritten, buffer.toString(encoding)))
			.catch(_cb);
	} else {
		// Signature 2: (fd, buffer, offset, length, position?, cb?)
		buffer = Buffer.from(data.buffer);
		offset = cbPosOff as number;
		length = cbLenEnc as number;
		position = typeof cbPosEnc === 'number' ? cbPosEnc : null;
		const _cb = (typeof cbPosEnc === 'function' ? cbPosEnc : cb) as Callback<[number, Uint8Array]>;
		void handle
			.write(buffer, offset, length, position)
			.then(({ bytesWritten }) => _cb(undefined, bytesWritten, buffer))
			.catch(_cb);
	}
}
write satisfies Omit<typeof fs.write, '__promisify__'>;

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
export function read(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number, cb: Callback<[number, Uint8Array]> = nop): void {
	new promises.FileHandle(fd)
		.read(buffer, offset, length, position)
		.then(({ bytesRead, buffer }) => cb(undefined, bytesRead, buffer))
		.catch(cb);
}
read satisfies Omit<typeof fs.read, '__promisify__'>;

/**
 * Asynchronous `fchown`.
 * @param fd
 * @param uid
 * @param gid
 * @param callback
 */
export function fchown(fd: number, uid: number, gid: number, cb: Callback = nop): void {
	new promises.FileHandle(fd)
		.chown(uid, gid)
		.then(() => cb())
		.catch(cb);
}
fchown satisfies Omit<typeof fs.fchown, '__promisify__'>;

/**
 * Asynchronous `fchmod`.
 * @param fd
 * @param mode
 * @param callback
 */
export function fchmod(fd: number, mode: string | number, cb: Callback): void {
	new promises.FileHandle(fd)
		.chmod(mode)
		.then(() => cb())
		.catch(cb);
}
fchmod satisfies Omit<typeof fs.fchmod, '__promisify__'>;

/**
 * Change the file timestamps of a file referenced by the supplied file
 * descriptor.
 * @param fd
 * @param atime
 * @param mtime
 * @param callback
 */
export function futimes(fd: number, atime: number | Date, mtime: number | Date, cb: Callback = nop): void {
	new promises.FileHandle(fd)
		.utimes(atime, mtime)
		.then(() => cb())
		.catch(cb);
}
futimes satisfies Omit<typeof fs.futimes, '__promisify__'>;

/**
 * Asynchronous `rmdir`.
 * @param path
 * @param callback
 */
export function rmdir(path: fs.PathLike, cb: Callback = nop): void {
	promises
		.rmdir(path)
		.then(() => cb())
		.catch(cb);
}
rmdir satisfies Omit<typeof fs.rmdir, '__promisify__'>;

/**
 * Asynchronous `mkdir`.
 * @param path
 * @param mode defaults to `0777`
 * @param callback
 */
export function mkdir(path: fs.PathLike, mode?: fs.Mode, cb: Callback = nop): void {
	promises
		.mkdir(path, mode)
		.then(() => cb())
		.catch(cb);
}
mkdir satisfies Omit<typeof fs.mkdir, '__promisify__'>;

/**
 * Asynchronous `readdir`. Reads the contents of a directory.
 * The callback gets two arguments `(err, files)` where `files` is an array of
 * the names of the files in the directory excluding `'.'` and `'..'`.
 * @param path
 * @param callback
 */
export function readdir(path: fs.PathLike, cb: Callback<[string[]]>): void;
export function readdir(path: fs.PathLike, options: { withFileTypes?: false }, cb: Callback<[string[]]>): void;
export function readdir(path: fs.PathLike, options: { withFileTypes: true }, cb: Callback<[Dirent[]]>): void;
export function readdir(path: fs.PathLike, _options: { withFileTypes?: boolean } | Callback<[string[]]>, cb: Callback<[string[]]> | Callback<[Dirent[]]> = nop): void {
	cb = typeof _options == 'function' ? _options : cb;
	const options = typeof _options != 'function' ? _options : {};
	promises
		.readdir(path, options as object)

		.then(entries => cb(undefined, entries as any))
		.catch(cb);
}
readdir satisfies Omit<typeof fs.readdir, '__promisify__'>;

/**
 * Asynchronous `link`.
 * @param existing
 * @param newpath
 * @param callback
 */
export function link(existing: fs.PathLike, newpath: fs.PathLike, cb: Callback = nop): void {
	promises
		.link(existing, newpath)
		.then(() => cb())
		.catch(cb);
}
link satisfies Omit<typeof fs.link, '__promisify__'>;

/**
 * Asynchronous `symlink`.
 * @param target target path
 * @param path link path
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 * @param callback
 */
export function symlink(target: fs.PathLike, path: fs.PathLike, cb?: Callback): void;
export function symlink(target: fs.PathLike, path: fs.PathLike, type?: fs.symlink.Type, cb?: Callback): void;
export function symlink(target: fs.PathLike, path: fs.PathLike, typeOrCB?: fs.symlink.Type | Callback, cb: Callback = nop): void {
	const type = typeof typeOrCB === 'string' ? typeOrCB : 'file';
	cb = typeof typeOrCB === 'function' ? typeOrCB : cb;
	promises
		.symlink(target, path, type)
		.then(() => cb())
		.catch(cb);
}
symlink satisfies Omit<typeof fs.symlink, '__promisify__'>;

/**
 * Asynchronous readlink.
 * @param path
 * @param callback
 */
export function readlink(path: fs.PathLike, callback: Callback<[string]> & any): void;
export function readlink(path: fs.PathLike, options: fs.BufferEncodingOption, callback: Callback<[Uint8Array]>): void;
export function readlink(path: fs.PathLike, options: fs.EncodingOption, callback: Callback<[string | Uint8Array]>): void;
export function readlink(path: fs.PathLike, options: fs.EncodingOption, callback: Callback<[string]>): void;
export function readlink(
	path: fs.PathLike,
	options: fs.BufferEncodingOption | fs.EncodingOption | Callback<[string]>,
	callback: Callback<[string]> | Callback<[Uint8Array]> = nop
): void {
	callback = typeof options == 'function' ? options : callback;
	promises
		.readlink(path)
		.then(result => (callback as Callback<[string | Uint8Array]>)(undefined, result))
		.catch(callback);
}
readlink satisfies Omit<typeof fs.readlink, '__promisify__'>;

/**
 * Asynchronous `chown`.
 * @param path
 * @param uid
 * @param gid
 * @param callback
 */
export function chown(path: fs.PathLike, uid: number, gid: number, cb: Callback = nop): void {
	promises
		.chown(path, uid, gid)
		.then(() => cb())
		.catch(cb);
}
chown satisfies Omit<typeof fs.chown, '__promisify__'>;

/**
 * Asynchronous `lchown`.
 * @param path
 * @param uid
 * @param gid
 * @param callback
 */
export function lchown(path: fs.PathLike, uid: number, gid: number, cb: Callback = nop): void {
	promises
		.lchown(path, uid, gid)
		.then(() => cb())
		.catch(cb);
}
lchown satisfies Omit<typeof fs.lchown, '__promisify__'>;

/**
 * Asynchronous `chmod`.
 * @param path
 * @param mode
 * @param callback
 */
export function chmod(path: fs.PathLike, mode: number | string, cb: Callback = nop): void {
	promises
		.chmod(path, mode)
		.then(() => cb())
		.catch(cb);
}
chmod satisfies Omit<typeof fs.chmod, '__promisify__'>;

/**
 * Asynchronous `lchmod`.
 * @param path
 * @param mode
 * @param callback
 */
export function lchmod(path: fs.PathLike, mode: number | string, cb: Callback = nop): void {
	promises
		.lchmod(path, mode)
		.then(() => cb())
		.catch(cb);
}
lchmod satisfies Omit<typeof fs.lchmod, '__promisify__'>;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 * @param callback
 */
export function utimes(path: fs.PathLike, atime: number | Date, mtime: number | Date, cb: Callback = nop): void {
	promises
		.utimes(path, atime, mtime)
		.then(() => cb())
		.catch(cb);
}
utimes satisfies Omit<typeof fs.utimes, '__promisify__'>;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 * @param callback
 */
export function lutimes(path: fs.PathLike, atime: number | Date, mtime: number | Date, cb: Callback = nop): void {
	promises
		.lutimes(path, atime, mtime)
		.then(() => cb())
		.catch(cb);
}
lutimes satisfies Omit<typeof fs.lutimes, '__promisify__'>;

/**
 * Asynchronous `realpath`. The callback gets two arguments
 * `(err, resolvedPath)`. May use `process.cwd` to resolve relative paths.
 *
 * @param path
 * @param callback
 */
export function realpath(path: fs.PathLike, cb?: Callback<[string]>): void;
export function realpath(path: fs.PathLike, options: fs.EncodingOption, cb: Callback<[string]>): void;
export function realpath(path: fs.PathLike, arg2?: Callback<[string]> | fs.EncodingOption, cb: Callback<[string]> = nop): void {
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises
		.realpath(path, typeof arg2 === 'function' ? null : arg2)
		.then(result => cb(undefined, result))
		.catch(cb);
}
realpath satisfies Omit<typeof fs.realpath, '__promisify__' | 'native'>;

/**
 * Asynchronous `access`.
 * @param path
 * @param mode
 * @param callback
 */
export function access(path: fs.PathLike, cb: Callback): void;
export function access(path: fs.PathLike, mode: number, cb: Callback): void;
export function access(path: fs.PathLike, cbMode: number | Callback, cb: Callback = nop): void {
	const mode = typeof cbMode === 'number' ? cbMode : R_OK;
	cb = typeof cbMode === 'function' ? cbMode : cb;
	promises
		.access(path, mode)
		.then(() => cb())
		.catch(cb);
}
access satisfies Omit<typeof fs.access, '__promisify__'>;

const statWatchers: Map<string, { watcher: StatWatcher; listeners: Set<(curr: Stats, prev: Stats) => void> }> = new Map();

/**
 * Watch for changes on a file. The callback listener will be called each time the file is accessed.
 *
 * The `options` argument may be omitted. If provided, it should be an object with a `persistent` boolean and an `interval` number specifying the polling interval in milliseconds.
 *
 * When a change is detected, the `listener` callback is called with the current and previous `Stats` objects.
 *
 * @param path The path to the file to watch.
 * @param options Optional options object specifying `persistent` and `interval`.
 * @param listener The callback listener to be called when the file changes.
 */
export function watchFile(path: fs.PathLike, listener: (curr: Stats, prev: Stats) => void): void;
export function watchFile(path: fs.PathLike, options: { persistent?: boolean; interval?: number }, listener: (curr: Stats, prev: Stats) => void): void;
export function watchFile(
	path: fs.PathLike,
	optsListener: { persistent?: boolean; interval?: number } | ((curr: Stats, prev: Stats) => void),
	listener?: (curr: Stats, prev: Stats) => void
): void {
	const normalizedPath = normalizePath(path.toString());
	const options: { persistent?: boolean; interval?: number } = typeof optsListener != 'function' ? optsListener : {};

	if (typeof optsListener === 'function') {
		listener = optsListener;
	}

	if (!listener) {
		throw new ErrnoError(Errno.EINVAL, 'No listener specified', path.toString(), 'watchFile');
	}

	if (statWatchers.has(normalizedPath)) {
		const entry = statWatchers.get(normalizedPath);
		if (entry) {
			entry.listeners.add(listener);
		}
		return;
	}

	const watcher = new StatWatcher(normalizedPath, options);
	watcher.on('change', (curr: Stats, prev: Stats) => {
		const entry = statWatchers.get(normalizedPath);
		if (!entry) {
			return;
		}
		for (const listener of entry.listeners) {
			listener(curr, prev);
		}
	});
	statWatchers.set(normalizedPath, { watcher, listeners: new Set() });
}
watchFile satisfies Omit<typeof fs.watchFile, '__promisify__'>;

/**
 * Stop watching for changes on a file.
 *
 * If the `listener` is specified, only that particular listener is removed.
 * If no `listener` is specified, all listeners are removed, and the file is no longer watched.
 *
 * @param path The path to the file to stop watching.
 * @param listener Optional listener to remove.
 */
export function unwatchFile(path: fs.PathLike, listener: (curr: Stats, prev: Stats) => void = nop): void {
	const normalizedPath = normalizePath(path.toString());

	const entry = statWatchers.get(normalizedPath);
	if (entry) {
		if (listener && listener !== nop) {
			entry.listeners.delete(listener);
		} else {
			// If no listener is specified, remove all listeners
			entry.listeners.clear();
		}
		if (entry.listeners.size === 0) {
			// No more listeners, stop the watcher
			entry.watcher.stop();
			statWatchers.delete(normalizedPath);
		}
	}
}
unwatchFile satisfies Omit<typeof fs.unwatchFile, '__promisify__'>;

export function watch(path: fs.PathLike, listener?: (event: string, filename: string) => any): fs.FSWatcher;
export function watch(path: fs.PathLike, options: { persistent?: boolean }, listener?: (event: string, filename: string) => any): fs.FSWatcher;
export function watch(
	path: fs.PathLike,
	options?: fs.WatchOptions | ((event: string, filename: string) => any),
	listener?: (event: string, filename: string) => any
): fs.FSWatcher {
	const watcher = new FSWatcher<string>(typeof options == 'object' ? options : {}, normalizePath(path));
	listener = typeof options == 'function' ? options : listener;
	watcher.on('change', listener || nop);
	return watcher;
}
watch satisfies Omit<typeof fs.watch, '__promisify__'>;

// From @types/node/fs (these types are not exported)
interface StreamOptions {
	flags?: string;
	encoding?: BufferEncoding;
	fd?: number | promises.FileHandle;
	mode?: number;
	autoClose?: boolean;
	emitClose?: boolean;
	start?: number;
	signal?: AbortSignal;
	highWaterMark?: number;
}
interface FSImplementation {
	open?: (...args: unknown[]) => unknown;
	close?: (...args: unknown[]) => unknown;
}
interface ReadStreamOptions extends StreamOptions {
	fs?: FSImplementation & {
		read: (...args: unknown[]) => unknown;
	};
	end?: number;
}
interface WriteStreamOptions extends StreamOptions {
	fs?: FSImplementation & {
		write: (...args: unknown[]) => unknown;
		writev?: (...args: unknown[]) => unknown;
	};
	flush?: boolean;
}

/**
 * Opens a file in read mode and creates a Node.js-like ReadStream.
 *
 * @param path The path to the file to be opened.
 * @param options Options for the ReadStream and file opening (e.g., `encoding`, `highWaterMark`, `mode`).
 * @returns A ReadStream object for interacting with the file's contents.
 */
export function createReadStream(path: fs.PathLike, _options?: BufferEncoding | ReadStreamOptions): ReadStream {
	const options = typeof _options == 'object' ? _options : { encoding: _options };
	let handle: promises.FileHandle;
	const stream = new ReadStream({
		highWaterMark: options.highWaterMark || 64 * 1024,
		encoding: options.encoding || 'utf8',
		async read(size: number) {
			try {
				handle ||= await promises.open(path, 'r', options?.mode);
				const result = await handle.read(new Uint8Array(size), 0, size, handle.file.position);
				stream.push(!result.bytesRead ? null : result.buffer.slice(0, result.bytesRead));
				handle.file.position += result.bytesRead;
				if (!result.bytesRead) {
					await handle.close();
				}
			} catch (error: any) {
				await handle?.close();
				stream.destroy(error);
			}
		},
		destroy(error, callback) {
			handle
				?.close()
				.then(() => callback(error))
				.catch(callback);
		},
	});

	stream.path = path.toString();
	return stream;
}
createReadStream satisfies Omit<typeof fs.createReadStream, '__promisify__'>;

/**
 * Opens a file in write mode and creates a Node.js-like WriteStream.
 *
 * @param path The path to the file to be opened.
 * @param options Options for the WriteStream and file opening (e.g., `encoding`, `highWaterMark`, `mode`).
 * @returns A WriteStream object for writing to the file.
 */
export function createWriteStream(path: fs.PathLike, _options?: BufferEncoding | WriteStreamOptions): WriteStream {
	const options = typeof _options == 'object' ? _options : { encoding: _options };
	let handle: promises.FileHandle;
	const stream = new WriteStream({
		highWaterMark: options?.highWaterMark,
		async write(chunk: Uint8Array, encoding: BufferEncoding, callback: (error?: Error) => void) {
			try {
				handle ||= await promises.open(path, 'w', options?.mode || 0o666);
				await handle.write(chunk, 0, encoding);
				callback(undefined);
			} catch (error: any) {
				await handle?.close();
				callback(error);
			}
		},
		destroy(error, callback) {
			callback(error);
			handle
				?.close()
				.then(() => callback(error))
				.catch(callback);
		},
		final(callback) {
			handle
				?.close()
				.then(() => callback())
				.catch(callback);
		},
	});

	stream.path = path.toString();
	return stream;
}
createWriteStream satisfies Omit<typeof fs.createWriteStream, '__promisify__'>;

export function rm(path: fs.PathLike, callback: Callback): void;
export function rm(path: fs.PathLike, options: fs.RmOptions, callback: Callback): void;
export function rm(path: fs.PathLike, options: fs.RmOptions | Callback, callback: Callback = nop): void {
	callback = typeof options === 'function' ? options : callback;
	promises
		.rm(path, typeof options === 'function' ? undefined : options)
		.then(() => callback(undefined))
		.catch(callback);
}
rm satisfies Omit<typeof fs.rm, '__promisify__'>;

/**
 * Asynchronously creates a unique temporary directory.
 * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
 */
export function mkdtemp(prefix: string, callback: Callback<[string]>): void;
export function mkdtemp(prefix: string, options: fs.EncodingOption, callback: Callback<[string]>): void;
export function mkdtemp(prefix: string, options: fs.BufferEncodingOption, callback: Callback<[Buffer]>): void;
export function mkdtemp(prefix: string, options: fs.EncodingOption | fs.BufferEncodingOption | Callback<[string]>, callback: Callback<[Buffer]> | Callback<[string]> = nop): void {
	callback = typeof options === 'function' ? options : callback;
	promises
		.mkdtemp(prefix, typeof options != 'function' ? (options as fs.EncodingOption) : null)
		.then(result => (callback as Callback<[string | Buffer]>)(undefined, result))
		.catch(callback);
}
mkdtemp satisfies Omit<typeof fs.mkdtemp, '__promisify__'>;

export function copyFile(src: fs.PathLike, dest: fs.PathLike, callback: Callback): void;
export function copyFile(src: fs.PathLike, dest: fs.PathLike, flags: number, callback: Callback): void;
export function copyFile(src: fs.PathLike, dest: fs.PathLike, flags: number | Callback, callback: Callback = nop): void {
	callback = typeof flags === 'function' ? flags : callback;
	promises
		.copyFile(src, dest, typeof flags === 'function' ? undefined : flags)
		.then(() => callback(undefined))
		.catch(callback);
}
copyFile satisfies Omit<typeof fs.copyFile, '__promisify__'>;

type readvCb = Callback<[number, NodeJS.ArrayBufferView[]]>;

export function readv(fd: number, buffers: NodeJS.ArrayBufferView[], cb: readvCb): void;
export function readv(fd: number, buffers: NodeJS.ArrayBufferView[], position: number, cb: readvCb): void;
export function readv(fd: number, buffers: NodeJS.ArrayBufferView[], position: number | readvCb, cb: readvCb = nop): void {
	cb = typeof position === 'function' ? position : cb;
	new promises.FileHandle(fd)
		.readv(buffers, typeof position === 'function' ? undefined : position)
		.then(({ buffers, bytesRead }) => cb(undefined, bytesRead, buffers))
		.catch(cb);
}
readv satisfies Omit<typeof fs.readv, '__promisify__'>;

type writevCb = Callback<[number, NodeJS.ArrayBufferView[]]>;

export function writev(fd: number, buffers: Uint8Array[], cb: writevCb): void;
export function writev(fd: number, buffers: Uint8Array[], position: number, cb: writevCb): void;
export function writev(fd: number, buffers: Uint8Array[], position: number | writevCb, cb: writevCb = nop) {
	cb = typeof position === 'function' ? position : cb;
	new promises.FileHandle(fd)
		.writev(buffers, typeof position === 'function' ? undefined : position)
		.then(({ buffers, bytesWritten }) => cb(undefined, bytesWritten, buffers))
		.catch(cb);
}
writev satisfies Omit<typeof fs.writev, '__promisify__'>;

export function opendir(path: fs.PathLike, cb: Callback<[Dir]>): void;
export function opendir(path: fs.PathLike, options: fs.OpenDirOptions, cb: Callback<[Dir]>): void;
export function opendir(path: fs.PathLike, options: fs.OpenDirOptions | Callback<[Dir]>, cb: Callback<[Dir]> = nop): void {
	cb = typeof options === 'function' ? options : cb;
	promises
		.opendir(path, typeof options === 'function' ? undefined : options)
		.then(result => cb(undefined, result))
		.catch(cb);
}
opendir satisfies Omit<typeof fs.opendir, '__promisify__'>;

export function cp(source: fs.PathLike, destination: fs.PathLike, callback: Callback): void;
export function cp(source: fs.PathLike, destination: fs.PathLike, opts: fs.CopyOptions, callback: Callback): void;
export function cp(source: fs.PathLike, destination: fs.PathLike, opts: fs.CopyOptions | Callback, callback: Callback = nop): void {
	callback = typeof opts === 'function' ? opts : callback;
	promises
		.cp(source, destination, typeof opts === 'function' ? undefined : opts)
		.then(() => callback(undefined))
		.catch(callback);
}
cp satisfies Omit<typeof fs.cp, '__promisify__'>;

export function statfs(path: fs.PathLike, callback: Callback<[fs.StatsFs]>): void;
export function statfs(path: fs.PathLike, options: fs.StatFsOptions & { bigint?: false }, callback: Callback<[fs.StatsFs]>): void;
export function statfs(path: fs.PathLike, options: fs.StatFsOptions & { bigint: true }, callback: Callback<[fs.BigIntStatsFs]>): void;
export function statfs(path: fs.PathLike, options?: fs.StatFsOptions | Callback<[fs.StatsFs]>, callback: Callback<[fs.StatsFs]> | Callback<[fs.BigIntStatsFs]> = nop): void {
	callback = typeof options === 'function' ? options : callback;
	promises
		.statfs(path, typeof options === 'function' ? undefined : options)
		.then(result => (callback as Callback<[fs.StatsFs | fs.BigIntStatsFs]>)(undefined, result))
		.catch(callback);
}
statfs satisfies Omit<typeof fs.statfs, '__promisify__'>;

export async function openAsBlob(path: fs.PathLike, options?: fs.OpenAsBlobOptions): Promise<Blob> {
	const handle = await promises.open(path.toString(), 'r');
	const buffer = await handle.readFile();
	await handle.close();
	return new Blob([buffer], options);
}
openAsBlob satisfies typeof fs.openAsBlob;
