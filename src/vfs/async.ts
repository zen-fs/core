import type * as fs from 'node:fs';
import type { V_Context } from '../context.js';
import type { Stats } from '../stats.js';
import type { Callback } from '../utils.js';
import type { Dir, Dirent } from './dir.js';
import type { FileContents, GlobOptionsU } from './types.js';

import { Buffer } from 'buffer';
import { Errno, ErrnoError } from '../internal/error.js';
import { BigIntStats } from '../stats.js';
import { normalizeMode, normalizePath } from '../utils.js';
import { R_OK } from './constants.js';
import * as promises from './promises.js';
import { fd2file, fdMap } from './shared.js';
import { ReadStream, WriteStream } from './streams.js';
import { FSWatcher, StatWatcher } from './watchers.js';

const nop = () => {};

/**
 * Helper to collect an async iterator into an array
 */
async function collectAsyncIterator<T>(it: NodeJS.AsyncIterator<T>): Promise<T[]> {
	const results: T[] = [];
	for await (const result of it) {
		results.push(result);
	}
	return results;
}

/**
 * Asynchronous rename. No arguments other than a possible exception are given to the completion callback.
 */
export function rename(this: V_Context, oldPath: fs.PathLike, newPath: fs.PathLike, cb: Callback = nop): void {
	promises.rename
		.call(this, oldPath, newPath)
		.then(() => cb())
		.catch(cb);
}
rename satisfies Omit<typeof fs.rename, '__promisify__'>;

/**
 * Test whether or not `path` exists by checking with the file system.
 * Then call the callback argument with either true or false.
 * @deprecated Use {@link stat} or {@link access} instead.
 */
export function exists(this: V_Context, path: fs.PathLike, cb: (exists: boolean) => unknown = nop): void {
	promises.exists
		.call(this, path)
		.then(cb)
		.catch(() => cb(false));
}
exists satisfies Omit<typeof fs.exists, '__promisify__'>;

export function stat(this: V_Context, path: fs.PathLike, callback: Callback<[Stats]>): void;
export function stat(this: V_Context, path: fs.PathLike, options: { bigint?: false }, callback: Callback<[Stats]>): void;
export function stat(this: V_Context, path: fs.PathLike, options: { bigint: true }, callback: Callback<[BigIntStats]>): void;
export function stat(this: V_Context, path: fs.PathLike, options: fs.StatOptions, callback: Callback<[Stats] | [BigIntStats]>): void;
export function stat(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.StatOptions | Callback<[Stats]>,
	callback: Callback<[Stats]> | Callback<[BigIntStats]> = nop
): void {
	callback = typeof options == 'function' ? options : callback;
	promises.stat
		.call(this, path, typeof options != 'function' ? options : {})
		.then(stats => (callback as Callback<[Stats] | [BigIntStats]>)(undefined, stats as any))
		.catch(callback);
}
stat satisfies Omit<typeof fs.stat, '__promisify__'>;

/**
 * Asynchronous `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 */
export function lstat(this: V_Context, path: fs.PathLike, callback: Callback<[Stats]>): void;
export function lstat(this: V_Context, path: fs.PathLike, options: fs.StatOptions & { bigint?: false }, callback: Callback<[Stats]>): void;
export function lstat(this: V_Context, path: fs.PathLike, options: fs.StatOptions & { bigint: true }, callback: Callback<[BigIntStats]>): void;
export function lstat(this: V_Context, path: fs.PathLike, options: fs.StatOptions, callback: Callback<[Stats | BigIntStats]>): void;
export function lstat(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.StatOptions | Callback<[Stats]>,
	callback: Callback<[Stats]> | Callback<[BigIntStats]> = nop
): void {
	callback = typeof options == 'function' ? options : callback;
	promises.lstat
		.call<V_Context, [fs.PathLike, fs.StatOptions?], Promise<Stats>>(this, path, typeof options != 'function' ? options : {})
		.then(stats => (callback as Callback<[Stats] | [BigIntStats]>)(undefined, stats))
		.catch(callback);
}
lstat satisfies Omit<typeof fs.lstat, '__promisify__'>;

export function truncate(this: V_Context, path: fs.PathLike, cb?: Callback): void;
export function truncate(this: V_Context, path: fs.PathLike, len: number, cb?: Callback): void;
export function truncate(this: V_Context, path: fs.PathLike, cbLen: number | Callback = 0, cb: Callback = nop): void {
	cb = typeof cbLen === 'function' ? cbLen : cb;
	const len = typeof cbLen === 'number' ? cbLen : 0;
	promises.truncate
		.call(this, path, len)
		.then(() => cb())
		.catch(cb);
}
truncate satisfies Omit<typeof fs.truncate, '__promisify__'>;

export function unlink(this: V_Context, path: fs.PathLike, cb: Callback = nop): void {
	promises.unlink
		.call(this, path)
		.then(() => cb())
		.catch(cb);
}
unlink satisfies Omit<typeof fs.unlink, '__promisify__'>;

/**
 * Asynchronous file open.
 * Exclusive mode ensures that path is newly created.
 * Mode defaults to `0644`
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
 */
export function open(this: V_Context, path: fs.PathLike, flag: string, cb?: Callback<[number]>): void;
export function open(this: V_Context, path: fs.PathLike, flag: string, mode: number | string, cb?: Callback<[number]>): void;
export function open(
	this: V_Context,
	path: fs.PathLike,
	flag: string,
	cbMode?: number | string | Callback<[number]>,
	cb: Callback<[number]> = nop
): void {
	const mode = normalizeMode(cbMode, 0o644);
	cb = typeof cbMode === 'function' ? cbMode : cb;
	promises.open
		.call(this, path, flag, mode)
		.then(handle => cb(undefined, handle.fd))
		.catch(cb);
}
open satisfies Omit<typeof fs.open, '__promisify__'>;

/**
 * Asynchronously reads the entire contents of a file.
 * @option encoding The string encoding for the file contents. Defaults to `null`.
 * @option flag Defaults to `'r'`.
 * @param cb If no encoding is specified, then the raw buffer is returned.
 */
export function readFile(this: V_Context, filename: fs.PathLike, cb: Callback<[Uint8Array]>): void;
export function readFile(this: V_Context, filename: fs.PathLike, options: { flag?: string }, callback?: Callback<[Uint8Array]>): void;
export function readFile(
	this: V_Context,
	filename: fs.PathLike,
	options: { encoding: BufferEncoding; flag?: string } | BufferEncoding,
	cb: Callback<[string]>
): void;
export function readFile(
	this: V_Context,
	filename: fs.PathLike,
	options?: fs.WriteFileOptions | BufferEncoding | Callback<[Uint8Array]>,
	cb: Callback<[string]> | Callback<[Uint8Array]> = nop
) {
	cb = typeof options === 'function' ? options : cb;

	promises.readFile
		.call(this, filename, typeof options === 'function' ? null : options)
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
 * @option encoding Defaults to `'utf8'`.
 * @option mode Defaults to `0644`.
 * @option flag Defaults to `'w'`.
 */
export function writeFile(this: V_Context, filename: fs.PathLike, data: FileContents, cb?: Callback): void;
export function writeFile(this: V_Context, filename: fs.PathLike, data: FileContents, encoding?: BufferEncoding, cb?: Callback): void;
export function writeFile(this: V_Context, filename: fs.PathLike, data: FileContents, options?: fs.WriteFileOptions, cb?: Callback): void;
export function writeFile(
	this: V_Context,
	filename: fs.PathLike,
	data: FileContents,
	cbEncOpts?: fs.WriteFileOptions | Callback,
	cb: Callback = nop
): void {
	cb = typeof cbEncOpts === 'function' ? cbEncOpts : cb;
	promises.writeFile
		.call(this, filename, data, typeof cbEncOpts != 'function' ? cbEncOpts : null)
		.then(() => cb(undefined))
		.catch(cb);
}
writeFile satisfies Omit<typeof fs.writeFile, '__promisify__'>;

/**
 * Asynchronously append data to a file, creating the file if it not yet
 * exists.
 *
 * @option encoding Defaults to `'utf8'`.
 * @option mode Defaults to `0644`.
 * @option flag Defaults to `'a'`.
 */
export function appendFile(this: V_Context, filename: fs.PathLike, data: FileContents, cb?: Callback): void;
export function appendFile(
	this: V_Context,
	filename: fs.PathLike,
	data: FileContents,
	options?: fs.EncodingOption & { mode?: fs.Mode; flag?: fs.OpenMode },
	cb?: Callback
): void;
export function appendFile(this: V_Context, filename: fs.PathLike, data: FileContents, encoding?: BufferEncoding, cb?: Callback): void;
export function appendFile(
	this: V_Context,
	filename: fs.PathLike,
	data: FileContents,
	cbEncOpts?: (fs.EncodingOption & { mode?: fs.Mode; flag?: fs.OpenMode }) | Callback,
	cb: Callback = nop
): void {
	const optionsOrEncoding = typeof cbEncOpts != 'function' ? cbEncOpts : undefined;
	cb = typeof cbEncOpts === 'function' ? cbEncOpts : cb;
	promises.appendFile
		.call(this, filename, data, optionsOrEncoding)
		.then(() => cb())
		.catch(cb);
}
appendFile satisfies Omit<typeof fs.appendFile, '__promisify__'>;

/**
 * Asynchronous `fstat`.
 * `fstat()` is identical to `stat()`, except that the file to be stat-ed is specified by the file descriptor `fd`.
 */
export function fstat(this: V_Context, fd: number, cb: Callback<[Stats]>): void;
export function fstat(this: V_Context, fd: number, options: fs.StatOptions & { bigint?: false }, cb: Callback<[Stats]>): void;
export function fstat(this: V_Context, fd: number, options: fs.StatOptions & { bigint: true }, cb: Callback<[BigIntStats]>): void;
export function fstat(
	this: V_Context,
	fd: number,
	options?: fs.StatOptions | Callback<[Stats]>,
	cb: Callback<[Stats]> | Callback<[BigIntStats]> = nop
): void {
	cb = typeof options == 'function' ? options : cb;

	fd2file(fd)
		.stat()
		.then(stats =>
			(cb as Callback<[Stats | BigIntStats]>)(undefined, typeof options == 'object' && options?.bigint ? new BigIntStats(stats) : stats)
		)
		.catch(cb);
}
fstat satisfies Omit<typeof fs.fstat, '__promisify__'>;

export function close(this: V_Context, fd: number, cb: Callback = nop): void {
	const close = fd2file(fd).close();
	fdMap.delete(fd);
	close.then(() => cb()).catch(cb);
}
close satisfies Omit<typeof fs.close, '__promisify__'>;

export function ftruncate(this: V_Context, fd: number, cb?: Callback): void;
export function ftruncate(this: V_Context, fd: number, len?: number, cb?: Callback): void;
export function ftruncate(this: V_Context, fd: number, lenOrCB?: number | Callback, cb: Callback = nop): void {
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

export function fsync(this: V_Context, fd: number, cb: Callback = nop): void {
	fd2file(fd)
		.sync()
		.then(() => cb())
		.catch(cb);
}
fsync satisfies Omit<typeof fs.fsync, '__promisify__'>;

export function fdatasync(this: V_Context, fd: number, cb: Callback = nop): void {
	fd2file(fd)
		.datasync()
		.then(() => cb())
		.catch(cb);
}
fdatasync satisfies Omit<typeof fs.fdatasync, '__promisify__'>;

/**
 * Write buffer to the file specified by `fd`.
 * Note that it is unsafe to use fs.write multiple times on the same file without waiting for the callback.
 * @param buffer Uint8Array containing the data to write to the file.
 * @param offset Offset in the buffer to start reading data from.
 * @param length The amount of bytes to write to the file.
 * @param position Offset from the beginning of the file where this data should be written.
 * If position is null, the data will be written at the current position.
 * @param cb The number specifies the number of bytes written into the file.
 */
export function write(this: V_Context, fd: number, buffer: Uint8Array, offset: number, length: number, cb?: Callback<[number, Uint8Array]>): void;
export function write(
	this: V_Context,
	fd: number,
	buffer: Uint8Array,
	offset: number,
	length: number,
	position?: number,
	cb?: Callback<[number, Uint8Array]>
): void;
export function write(this: V_Context, fd: number, data: FileContents, cb?: Callback<[number, string]>): void;
export function write(this: V_Context, fd: number, data: FileContents, position?: number, cb?: Callback<[number, string]>): void;
export function write(
	this: V_Context,
	fd: number,
	data: FileContents,
	position: number | null,
	encoding: BufferEncoding,
	cb?: Callback<[number, string]>
): void;
export function write(
	this: V_Context,
	fd: number,
	data: FileContents,
	cbPosOff?: number | Callback<[number, string]> | null,
	cbLenEnc?: number | BufferEncoding | Callback<[number, string]>,
	cbPosEnc?: number | BufferEncoding | Callback<[number, Uint8Array]> | Callback<[number, string]>,
	cb: Callback<[number, Uint8Array]> | Callback<[number, string]> = nop
): void {
	let buffer: Buffer, offset: number | undefined, length: number | undefined, position: number | undefined | null, encoding: BufferEncoding;
	const handle = new promises.FileHandle(fd, this);
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
				cb = (typeof cbLenEnc === 'function' ? cbLenEnc : typeof cbPosEnc === 'function' ? cbPosEnc : cb) as Callback<
					[number, Uint8Array | string]
				>;
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
 * @param buffer The buffer that the data will be written to.
 * @param offset The offset within the buffer where writing will start.
 * @param length An integer specifying the number of bytes to read.
 * @param position An integer specifying where to begin reading from in the file.
 * If position is null, data will be read from the current file position.
 * @param cb The number is the number of bytes read
 */
export function read(
	this: V_Context,
	fd: number,
	buffer: Uint8Array,
	offset: number,
	length: number,
	position?: number,
	cb: Callback<[number, Uint8Array]> = nop
): void {
	new promises.FileHandle(fd, this)
		.read(buffer, offset, length, position)
		.then(({ bytesRead, buffer }) => cb(undefined, bytesRead, buffer))
		.catch(cb);
}
read satisfies Omit<typeof fs.read, '__promisify__'>;

export function fchown(this: V_Context, fd: number, uid: number, gid: number, cb: Callback = nop): void {
	new promises.FileHandle(fd, this)
		.chown(uid, gid)
		.then(() => cb())
		.catch(cb);
}
fchown satisfies Omit<typeof fs.fchown, '__promisify__'>;

export function fchmod(this: V_Context, fd: number, mode: string | number, cb: Callback): void {
	new promises.FileHandle(fd, this)
		.chmod(mode)
		.then(() => cb())
		.catch(cb);
}
fchmod satisfies Omit<typeof fs.fchmod, '__promisify__'>;

/**
 * Change the file timestamps of a file referenced by the supplied file descriptor.
 */
export function futimes(this: V_Context, fd: number, atime: number | Date, mtime: number | Date, cb: Callback = nop): void {
	new promises.FileHandle(fd, this)
		.utimes(atime, mtime)
		.then(() => cb())
		.catch(cb);
}
futimes satisfies Omit<typeof fs.futimes, '__promisify__'>;

export function rmdir(this: V_Context, path: fs.PathLike, cb: Callback = nop): void {
	promises.rmdir
		.call(this, path)
		.then(() => cb())
		.catch(cb);
}
rmdir satisfies Omit<typeof fs.rmdir, '__promisify__'>;

/**
 * Asynchronous `mkdir`.
 * @param mode defaults to `0777`
 */
export function mkdir(this: V_Context, path: fs.PathLike, mode?: fs.Mode, cb: Callback = nop): void {
	promises.mkdir
		.call(this, path, mode)
		.then(() => cb())
		.catch(cb);
}
mkdir satisfies Omit<typeof fs.mkdir, '__promisify__'>;

/**
 * Asynchronous `readdir`. Reads the contents of a directory.
 * The callback gets two arguments `(err, files)` where `files` is an array of
 * the names of the files in the directory excluding `'.'` and `'..'`.
 */
export function readdir(this: V_Context, path: fs.PathLike, cb: Callback<[string[]]>): void;
export function readdir(this: V_Context, path: fs.PathLike, options: { withFileTypes?: false }, cb: Callback<[string[]]>): void;
export function readdir(this: V_Context, path: fs.PathLike, options: { withFileTypes: true }, cb: Callback<[Dirent[]]>): void;
export function readdir(
	this: V_Context,
	path: fs.PathLike,
	_options: { withFileTypes?: boolean } | Callback<[string[]]>,
	cb: Callback<[string[]]> | Callback<[Dirent[]]> = nop
): void {
	cb = typeof _options == 'function' ? _options : cb;
	const options = typeof _options != 'function' ? _options : {};
	promises.readdir
		.call(this, path, options as object)

		.then(entries => cb(undefined, entries as any))
		.catch(cb);
}
readdir satisfies Omit<typeof fs.readdir, '__promisify__'>;

export function link(this: V_Context, existing: fs.PathLike, newpath: fs.PathLike, cb: Callback = nop): void {
	promises.link
		.call(this, existing, newpath)
		.then(() => cb())
		.catch(cb);
}
link satisfies Omit<typeof fs.link, '__promisify__'>;

/**
 * Asynchronous `symlink`.
 * @param target target path
 * @param path link path
 * Type defaults to file
 */
export function symlink(this: V_Context, target: fs.PathLike, path: fs.PathLike, cb?: Callback): void;
export function symlink(this: V_Context, target: fs.PathLike, path: fs.PathLike, type?: fs.symlink.Type, cb?: Callback): void;
export function symlink(this: V_Context, target: fs.PathLike, path: fs.PathLike, typeOrCB?: fs.symlink.Type | Callback, cb: Callback = nop): void {
	const type = typeof typeOrCB === 'string' ? typeOrCB : 'file';
	cb = typeof typeOrCB === 'function' ? typeOrCB : cb;
	promises.symlink
		.call(this, target, path, type)
		.then(() => cb())
		.catch(cb);
}
symlink satisfies Omit<typeof fs.symlink, '__promisify__'>;

export function readlink(this: V_Context, path: fs.PathLike, callback: Callback<[string]>): void;
export function readlink(this: V_Context, path: fs.PathLike, options: fs.BufferEncodingOption, callback: Callback<[Uint8Array]>): void;
export function readlink(this: V_Context, path: fs.PathLike, options: fs.EncodingOption, callback: Callback<[string | Uint8Array]>): void;
export function readlink(this: V_Context, path: fs.PathLike, options: fs.EncodingOption, callback: Callback<[string]>): void;
export function readlink(
	this: V_Context,
	path: fs.PathLike,
	options: fs.BufferEncodingOption | fs.EncodingOption | Callback<[string]>,
	callback: Callback<[string]> | Callback<[Uint8Array]> = nop
): void {
	callback = typeof options == 'function' ? options : callback;
	promises.readlink
		.call(this, path)
		.then(result => (callback as Callback<[string | Uint8Array]>)(undefined, result))
		.catch(callback);
}
readlink satisfies Omit<typeof fs.readlink, '__promisify__'>;

export function chown(this: V_Context, path: fs.PathLike, uid: number, gid: number, cb: Callback = nop): void {
	promises.chown
		.call(this, path, uid, gid)
		.then(() => cb())
		.catch(cb);
}
chown satisfies Omit<typeof fs.chown, '__promisify__'>;

export function lchown(this: V_Context, path: fs.PathLike, uid: number, gid: number, cb: Callback = nop): void {
	promises.lchown
		.call(this, path, uid, gid)
		.then(() => cb())
		.catch(cb);
}
lchown satisfies Omit<typeof fs.lchown, '__promisify__'>;

export function chmod(this: V_Context, path: fs.PathLike, mode: number | string, cb: Callback = nop): void {
	promises.chmod
		.call(this, path, mode)
		.then(() => cb())
		.catch(cb);
}
chmod satisfies Omit<typeof fs.chmod, '__promisify__'>;

export function lchmod(this: V_Context, path: fs.PathLike, mode: number | string, cb: Callback = nop): void {
	promises.lchmod
		.call(this, path, mode)
		.then(() => cb())
		.catch(cb);
}
lchmod satisfies Omit<typeof fs.lchmod, '__promisify__'>;

/**
 * Change file timestamps of the file referenced by the supplied path.
 */
export function utimes(this: V_Context, path: fs.PathLike, atime: number | Date, mtime: number | Date, cb: Callback = nop): void {
	promises.utimes
		.call(this, path, atime, mtime)
		.then(() => cb())
		.catch(cb);
}
utimes satisfies Omit<typeof fs.utimes, '__promisify__'>;

/**
 * Change file timestamps of the file referenced by the supplied path.
 */
export function lutimes(this: V_Context, path: fs.PathLike, atime: number | Date, mtime: number | Date, cb: Callback = nop): void {
	promises.lutimes
		.call(this, path, atime, mtime)
		.then(() => cb())
		.catch(cb);
}
lutimes satisfies Omit<typeof fs.lutimes, '__promisify__'>;

/**
 * Asynchronous `realpath`. The callback gets two arguments
 * `(err, resolvedPath)`. May use `process.cwd` to resolve relative paths.
 */
export function realpath(this: V_Context, path: fs.PathLike, cb?: Callback<[string]>): void;
export function realpath(this: V_Context, path: fs.PathLike, options: fs.EncodingOption, cb: Callback<[string]>): void;
export function realpath(this: V_Context, path: fs.PathLike, arg2?: Callback<[string]> | fs.EncodingOption, cb: Callback<[string]> = nop): void {
	cb = typeof arg2 === 'function' ? arg2 : cb;
	promises.realpath
		.call(this, path, typeof arg2 === 'function' ? null : arg2)
		.then(result => cb(undefined, result))
		.catch(cb);
}
realpath satisfies Omit<typeof fs.realpath, '__promisify__' | 'native'>;

export function access(this: V_Context, path: fs.PathLike, cb: Callback): void;
export function access(this: V_Context, path: fs.PathLike, mode: number, cb: Callback): void;
export function access(this: V_Context, path: fs.PathLike, cbMode: number | Callback, cb: Callback = nop): void {
	const mode = typeof cbMode === 'number' ? cbMode : R_OK;
	cb = typeof cbMode === 'function' ? cbMode : cb;
	promises.access
		.call(this, path, mode)
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
export function watchFile(this: V_Context, path: fs.PathLike, listener: (curr: Stats, prev: Stats) => void): void;
export function watchFile(
	this: V_Context,
	path: fs.PathLike,
	options: { persistent?: boolean; interval?: number },
	listener: (curr: Stats, prev: Stats) => void
): void;
export function watchFile(
	this: V_Context,
	path: fs.PathLike,
	options: { persistent?: boolean; interval?: number } | ((curr: Stats, prev: Stats) => void),
	listener?: (curr: Stats, prev: Stats) => void
): void {
	const normalizedPath = normalizePath(path.toString());
	const opts = typeof options != 'function' ? options : {};

	if (typeof options == 'function') {
		listener = options;
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

	const watcher = new StatWatcher(this, normalizedPath, opts);
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
export function unwatchFile(this: V_Context, path: fs.PathLike, listener: (curr: Stats, prev: Stats) => void = nop): void {
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

export function watch(this: V_Context, path: fs.PathLike, listener?: (event: string, filename: string) => any): FSWatcher;
export function watch(
	this: V_Context,
	path: fs.PathLike,
	options: { persistent?: boolean },
	listener?: (event: string, filename: string) => any
): FSWatcher;
export function watch(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.WatchOptions | ((event: string, filename: string) => any),
	listener?: (event: string, filename: string) => any
): FSWatcher {
	const watcher = new FSWatcher<string>(this, normalizePath(path), typeof options == 'object' ? options : {});
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
export function createReadStream(this: V_Context, path: fs.PathLike, options?: BufferEncoding | ReadStreamOptions): ReadStream {
	const context = this;
	options = typeof options == 'object' ? options : { encoding: options };
	let handle: promises.FileHandle;
	const stream = new ReadStream({
		highWaterMark: options.highWaterMark || 64 * 1024,
		encoding: options.encoding || 'utf8',
		async read(size: number) {
			try {
				handle ||= await promises.open.call(context, path, 'r', options?.mode);
				const result = await handle.read(new Uint8Array(size), 0, size, handle.file.position);
				stream.push(!result.bytesRead ? null : result.buffer.subarray(0, result.bytesRead));
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
				.catch(nop);
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
export function createWriteStream(this: V_Context, path: fs.PathLike, options?: BufferEncoding | WriteStreamOptions): WriteStream {
	const context = this;
	options = typeof options == 'object' ? options : { encoding: options };
	let handle: promises.FileHandle;
	const stream = new WriteStream({
		highWaterMark: options?.highWaterMark,
		async write(chunk: Uint8Array, encoding: BufferEncoding, callback: (error?: Error) => void) {
			try {
				handle ||= await promises.open.call(context, path, 'w', options?.mode || 0o666);
				await handle.write(chunk, 0, encoding);
				callback(undefined);
			} catch (error: any) {
				await handle?.close();
				callback(error);
			}
		},
		destroy(error, callback) {
			callback(error);
			void handle
				?.close()
				.then(() => callback(error))
				.catch(callback);
		},
		final(callback) {
			void handle
				?.close()
				.then(() => callback())
				.catch(callback);
		},
	});

	stream.path = path.toString();
	return stream;
}
createWriteStream satisfies Omit<typeof fs.createWriteStream, '__promisify__'>;

export function rm(this: V_Context, path: fs.PathLike, callback: Callback): void;
export function rm(this: V_Context, path: fs.PathLike, options: fs.RmOptions, callback: Callback): void;
export function rm(this: V_Context, path: fs.PathLike, options: fs.RmOptions | Callback, callback: Callback = nop): void {
	callback = typeof options === 'function' ? options : callback;
	promises.rm
		.call(this, path, typeof options === 'function' ? undefined : options)
		.then(() => callback(undefined))
		.catch(callback);
}
rm satisfies Omit<typeof fs.rm, '__promisify__'>;

/**
 * Asynchronously creates a unique temporary directory.
 * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
 */
export function mkdtemp(this: V_Context, prefix: string, callback: Callback<[string]>): void;
export function mkdtemp(this: V_Context, prefix: string, options: fs.EncodingOption, callback: Callback<[string]>): void;
export function mkdtemp(this: V_Context, prefix: string, options: fs.BufferEncodingOption, callback: Callback<[Buffer]>): void;
export function mkdtemp(
	this: V_Context,
	prefix: string,
	options: fs.EncodingOption | fs.BufferEncodingOption | Callback<[string]>,
	callback: Callback<[Buffer]> | Callback<[string]> = nop
): void {
	callback = typeof options === 'function' ? options : callback;
	promises.mkdtemp
		.call<V_Context, [string, fs.EncodingOption], Promise<string>>(
			this,
			prefix,
			typeof options != 'function' ? (options as fs.EncodingOption) : null
		)
		.then(result => (callback as Callback<[string | Buffer]>)(undefined, result))
		.catch(callback);
}
mkdtemp satisfies Omit<typeof fs.mkdtemp, '__promisify__'>;

export function copyFile(this: V_Context, src: fs.PathLike, dest: fs.PathLike, callback: Callback): void;
export function copyFile(this: V_Context, src: fs.PathLike, dest: fs.PathLike, flags: number, callback: Callback): void;
export function copyFile(this: V_Context, src: fs.PathLike, dest: fs.PathLike, flags: number | Callback, callback: Callback = nop): void {
	callback = typeof flags === 'function' ? flags : callback;
	promises.copyFile
		.call(this, src, dest, typeof flags === 'function' ? undefined : flags)
		.then(() => callback(undefined))
		.catch(callback);
}
copyFile satisfies Omit<typeof fs.copyFile, '__promisify__'>;

type readvCb = Callback<[number, NodeJS.ArrayBufferView[]]>;

export function readv(this: V_Context, fd: number, buffers: NodeJS.ArrayBufferView[], cb: readvCb): void;
export function readv(this: V_Context, fd: number, buffers: NodeJS.ArrayBufferView[], position: number, cb: readvCb): void;
export function readv(this: V_Context, fd: number, buffers: NodeJS.ArrayBufferView[], position: number | readvCb, cb: readvCb = nop): void {
	cb = typeof position === 'function' ? position : cb;
	new promises.FileHandle(fd, this)
		.readv(buffers, typeof position === 'function' ? undefined : position)
		.then(({ buffers, bytesRead }) => cb(undefined, bytesRead, buffers))
		.catch(cb);
}
readv satisfies Omit<typeof fs.readv, '__promisify__'>;

type writevCb = Callback<[number, NodeJS.ArrayBufferView[]]>;

export function writev(this: V_Context, fd: number, buffers: Uint8Array[], cb: writevCb): void;
export function writev(this: V_Context, fd: number, buffers: Uint8Array[], position: number, cb: writevCb): void;
export function writev(this: V_Context, fd: number, buffers: Uint8Array[], position: number | writevCb, cb: writevCb = nop) {
	cb = typeof position === 'function' ? position : cb;
	new promises.FileHandle(fd, this)
		.writev(buffers, typeof position === 'function' ? undefined : position)
		.then(({ buffers, bytesWritten }) => cb(undefined, bytesWritten, buffers))
		.catch(cb);
}
writev satisfies Omit<typeof fs.writev, '__promisify__'>;

export function opendir(this: V_Context, path: fs.PathLike, cb: Callback<[Dir]>): void;
export function opendir(this: V_Context, path: fs.PathLike, options: fs.OpenDirOptions, cb: Callback<[Dir]>): void;
export function opendir(this: V_Context, path: fs.PathLike, options: fs.OpenDirOptions | Callback<[Dir]>, cb: Callback<[Dir]> = nop): void {
	cb = typeof options === 'function' ? options : cb;
	promises.opendir
		.call(this, path, typeof options === 'function' ? undefined : options)
		.then(result => cb(undefined, result))
		.catch(cb);
}
opendir satisfies Omit<typeof fs.opendir, '__promisify__'>;

export function cp(this: V_Context, source: fs.PathLike, destination: fs.PathLike, callback: Callback): void;
export function cp(this: V_Context, source: fs.PathLike, destination: fs.PathLike, opts: fs.CopyOptions, callback: Callback): void;
export function cp(this: V_Context, source: fs.PathLike, destination: fs.PathLike, opts: fs.CopyOptions | Callback, callback: Callback = nop): void {
	callback = typeof opts === 'function' ? opts : callback;
	promises.cp
		.call(this, source, destination, typeof opts === 'function' ? undefined : opts)
		.then(() => callback(undefined))
		.catch(callback);
}
cp satisfies Omit<typeof fs.cp, '__promisify__'>;

export function statfs(this: V_Context, path: fs.PathLike, callback: Callback<[fs.StatsFs]>): void;
export function statfs(this: V_Context, path: fs.PathLike, options: fs.StatFsOptions & { bigint?: false }, callback: Callback<[fs.StatsFs]>): void;
export function statfs(
	this: V_Context,
	path: fs.PathLike,
	options: fs.StatFsOptions & { bigint: true },
	callback: Callback<[fs.BigIntStatsFs]>
): void;
export function statfs(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.StatFsOptions | Callback<[fs.StatsFs]>,
	callback: Callback<[fs.StatsFs]> | Callback<[fs.BigIntStatsFs]> = nop
): void {
	callback = typeof options === 'function' ? options : callback;
	promises.statfs
		.call(this, path, typeof options === 'function' ? undefined : options)
		.then(result => (callback as Callback<[fs.StatsFs | fs.BigIntStatsFs]>)(undefined, result))
		.catch(callback);
}
statfs satisfies Omit<typeof fs.statfs, '__promisify__'>;

export async function openAsBlob(this: V_Context, path: fs.PathLike, options?: fs.OpenAsBlobOptions): Promise<Blob> {
	const handle = await promises.open.call(this, path.toString(), 'r');
	const buffer = await handle.readFile();
	await handle.close();
	return new Blob([buffer], options);
}
openAsBlob satisfies typeof fs.openAsBlob;

type GlobCallback<Args extends unknown[]> = (e: ErrnoError | null, ...args: Args) => unknown;

/**
 * Retrieves the files matching the specified pattern.
 */
export function glob(this: V_Context, pattern: string | string[], callback: GlobCallback<[string[]]>): void;
export function glob(this: V_Context, pattern: string | string[], options: fs.GlobOptionsWithFileTypes, callback: GlobCallback<[Dirent[]]>): void;
export function glob(this: V_Context, pattern: string | string[], options: fs.GlobOptionsWithoutFileTypes, callback: GlobCallback<[string[]]>): void;
export function glob(this: V_Context, pattern: string | string[], options: fs.GlobOptions, callback: GlobCallback<[Dirent[] | string[]]>): void;
export function glob(
	this: V_Context,
	pattern: string | string[],
	options: GlobOptionsU | GlobCallback<[string[]]>,
	callback: GlobCallback<[Dirent[]]> | GlobCallback<[string[]]> = nop
): void {
	callback = typeof options == 'function' ? options : callback;

	const it = promises.glob.call<V_Context, [string | string[], GlobOptionsU?], NodeJS.AsyncIterator<Dirent | string>>(
		this,
		pattern,
		typeof options === 'function' ? undefined : options
	);
	collectAsyncIterator(it)
		.then(results => callback(null, (results as any) ?? []))
		.catch((e: ErrnoError) => callback(e));
}
glob satisfies typeof fs.glob;
