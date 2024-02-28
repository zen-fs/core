import type * as Node from 'node:fs';
import { ApiError, ErrorCode } from '../ApiError.js';
export * as constants from './constants.js';
import { File, FileFlag } from '../file.js';
import { normalizePath, normalizeMode, getFdForFile, normalizeOptions, fd2file, fdMap, normalizeTime, cred, nop, resolveFS, fixError, mounts } from './shared.js';
import type { PathLike, BufferToUint8Array } from './shared.js';
import { FileContents, FileSystem } from '../filesystem.js';
import { BigIntStats, Stats } from '../stats.js';
import { decode, encode } from '../utils.js';
import { Dirent } from './dir.js';
import { join } from './path.js';

export class FileHandle implements BufferToUint8Array<Node.promises.FileHandle> {
	public constructor(
		/**
		 * Gets the file descriptor for this file handle.
		 */
		public readonly fd: number,
		private path?: string
	) {}

	/**
	 * Asynchronous fchown(2) - Change ownership of a file.
	 */
	public chown(uid: number, gid: number): Promise<void> {
		return fd2file(this.fd).chown(uid, gid);
	}

	/**
	 * Asynchronous fchmod(2) - Change permissions of a file.
	 * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
	 */
	public chmod(mode: Node.Mode): Promise<void> {
		return fd2file(this.fd).chmod(normalizeMode(mode));
	}

	/**
	 * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
	 */
	public datasync(): Promise<void> {
		return fd2file(this.fd).datasync();
	}

	/**
	 * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
	 */
	public sync(): Promise<void> {
		return fd2file(this.fd).sync();
	}

	/**
	 * Asynchronous ftruncate(2) - Truncate a file to a specified length.
	 * @param len If not specified, defaults to `0`.
	 */
	public truncate(len?: number): Promise<void> {
		return fd2file(this.fd).truncate(len);
	}

	/**
	 * Asynchronously change file timestamps of the file.
	 * @param atime The last access time. If a string is provided, it will be coerced to number.
	 * @param mtime The last modified time. If a string is provided, it will be coerced to number.
	 */
	public utimes(atime: string | number | Date, mtime: string | number | Date): Promise<void> {
		return fd2file(this.fd).utimes(normalizeTime(atime), normalizeTime(mtime));
	}

	/**
	 * Asynchronously append data to a file, creating the file if it does not exist. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for appending.
	 * @param data The data to write. If something other than a `Buffer` or `Uint8Array` is provided, the value is coerced to a string.
	 * @param options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
	 * If `encoding` is not supplied, the default of `'utf8'` is used.
	 * If `mode` is not supplied, the default of `0o666` is used.
	 * If `mode` is a string, it is parsed as an octal integer.
	 * If `flag` is not supplied, the default of `'a'` is used.
	 */
	public appendFile(data: string | Uint8Array, options?: { encoding?: BufferEncoding; mode?: Node.Mode; flag?: Node.OpenMode } | BufferEncoding): Promise<void> {
		return appendFile(this.path, data, options);
	}

	/**
	 * Asynchronously reads data from the file.
	 * The `FileHandle` must have been opened for reading.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset in the buffer at which to start writing.
	 * @param length The number of bytes to read.
	 * @param position The offset from the beginning of the file from which data should be read. If `null`, data will be read from the current position.
	 */
	public read<TBuffer extends Uint8Array>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: TBuffer }> {
		return fd2file(this.fd).read(buffer, offset, length, position);
	}

	/**
	 * Asynchronously reads the entire contents of a file. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for reading.
	 * @param options An object that may contain an optional flag.
	 * If a flag is not provided, it defaults to `'r'`.
	 */
	public readFile(options?: { flag?: Node.OpenMode }): Promise<Uint8Array>;
	public readFile(options: { encoding: BufferEncoding; flag?: Node.OpenMode } | BufferEncoding): Promise<string>;
	public readFile(options?: { encoding?: BufferEncoding; flag?: Node.OpenMode } | BufferEncoding): Promise<string | Uint8Array> {
		return readFile(this.path, options);
	}

	/**
	 * Asynchronous fstat(2) - Get file status.
	 */
	public stat(opts: Node.BigIntOptions): Promise<BigIntStats>;
	public stat(opts?: Node.StatOptions & { bigint?: false }): Promise<Stats>;
	public stat(opts?: Node.StatOptions): Promise<Stats | BigIntStats> {
		return stat(this.path, opts);
	}

	async write(data: FileContents, posOrOff?: number, lenOrEnc?: BufferEncoding | number, position?: number): Promise<{ bytesWritten: number; buffer: FileContents }>;

	/**
	 * Asynchronously writes `buffer` to the file.
	 * The `FileHandle` must have been opened for writing.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
	 * @param length The number of bytes to write. If not supplied, defaults to `buffer.length - offset`.
	 * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
	 */
	async write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<{ bytesWritten: number; buffer: Uint8Array }>;

	/**
	 * Asynchronously writes `string` to the file.
	 * The `FileHandle` must have been opened for writing.
	 * It is unsafe to call `write()` multiple times on the same file without waiting for the `Promise`
	 * to be resolved (or rejected). For this scenario, `fs.createWriteStream` is strongly recommended.
	 * @param string A string to write.
	 * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
	 * @param encoding The expected string encoding.
	 */
	async write(data: string, position?: number, encoding?: BufferEncoding): Promise<{ bytesWritten: number; buffer: string }>;

	async write(data: FileContents, posOrOff?: number, lenOrEnc?: BufferEncoding | number, position?: number): Promise<{ bytesWritten: number; buffer: FileContents }> {
		let buffer: Uint8Array,
			offset: number = 0,
			length: number;
		if (typeof data === 'string') {
			// Signature 1: (fd, string, [position?, [encoding?]])
			position = typeof posOrOff === 'number' ? posOrOff : null;
			const encoding = <BufferEncoding>(typeof lenOrEnc === 'string' ? lenOrEnc : 'utf8');
			offset = 0;
			buffer = encode(data, encoding);
			length = buffer.length;
		} else {
			// Signature 2: (fd, buffer, offset, length, position?)
			buffer = data;
			offset = posOrOff;
			length = lenOrEnc as number;
			position = typeof position === 'number' ? position : null;
		}

		const file = fd2file(this.fd);
		position ??= file.position!;
		const bytesWritten = await file.write(buffer, offset, length, position);
		return { buffer, bytesWritten };
	}

	/**
	 * Asynchronously writes data to a file, replacing the file if it already exists. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for writing.
	 * It is unsafe to call `writeFile()` multiple times on the same file without waiting for the `Promise` to be resolved (or rejected).
	 * @param data The data to write. If something other than a `Buffer` or `Uint8Array` is provided, the value is coerced to a string.
	 * @param options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
	 * If `encoding` is not supplied, the default of `'utf8'` is used.
	 * If `mode` is not supplied, the default of `0o666` is used.
	 * If `mode` is a string, it is parsed as an octal integer.
	 * If `flag` is not supplied, the default of `'w'` is used.
	 */
	writeFile(data: string | Uint8Array, options?: (Node.BaseEncodingOptions & { mode?: Node.Mode; flag?: Node.OpenMode }) | BufferEncoding): Promise<void> {
		return writeFile(this.path, data, options);
	}

	/**
	 * See `fs.writev` promisified version.
	 */
	writev(buffers: ReadonlyArray<Uint8Array>, position?: number): Promise<Node.WriteVResult> {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	/**
	 * See `fs.readv` promisified version.
	 */
	readv(buffers: ReadonlyArray<Uint8Array>, position?: number): Promise<Node.ReadVResult> {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	/**
	 * Asynchronous close(2) - close a `FileHandle`.
	 */
	close(): Promise<void> {
		return fd2file(this.fd).close();
	}
}

export function getHandle(fd: number): FileHandle {
	if (!fdMap.has(fd)) {
		throw new ApiError(ErrorCode.EBADF);
	}
	return;
}

type FileSystemMethod = {
	[K in keyof FileSystem]: FileSystem[K] extends (...args) => unknown
		? (name: K, resolveSymlinks: boolean, ...args: Parameters<FileSystem[K]>) => ReturnType<FileSystem[K]>
		: never;
}[keyof FileSystem]; // https://stackoverflow.com/a/76335220/17637456

/**
 * Utility for FS ops. It handles
 * - path normalization (for the first parameter to the FS op)
 * - path translation for errors
 * - FS/mount point resolution
 *
 * It can't be used for functions which may operate on multiple mounted FSs or paths (e.g. `rename`)
 * @param name the function name
 * @param resolveSymlinks whether to resolve symlinks
 * @param args the rest of the parameters are passed to the FS function. Note that the first parameter is required to be a path
 * @returns
 */
async function doOp<M extends FileSystemMethod, RT extends ReturnType<M> = ReturnType<M>>(...[name, resolveSymlinks, path, ...args]: Parameters<M>): Promise<RT> {
	path = normalizePath(path);
	const { fs, path: resolvedPath } = resolveFS(resolveSymlinks && (await exists(path)) ? await realpath(path) : path);
	try {
		// @ts-expect-error 2556 (since ...args is not correctly picked up as being a tuple)
		return fs[name](resolvedPath, ...args) as Promise<RT>;
	} catch (e) {
		throw fixError(e, { [resolvedPath]: path });
	}
}

// fs.promises

/**
 * Renames a file
 * @param oldPath
 * @param newPath
 */
export async function rename(oldPath: PathLike, newPath: PathLike): Promise<void> {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const _old = resolveFS(oldPath);
	const _new = resolveFS(newPath);
	const paths = { [_old.path]: oldPath, [_new.path]: newPath };
	try {
		if (_old === _new) {
			return _old.fs.rename(_old.path, _new.path, cred);
		}

		const data = await readFile(oldPath);
		await writeFile(newPath, data);
		await unlink(oldPath);
	} catch (e) {
		throw fixError(e, paths);
	}
}
rename satisfies typeof Node.promises.rename;

/**
 * Test whether or not the given path exists by checking with the file system.
 * @param path
 */
export async function exists(path: PathLike): Promise<boolean> {
	path = normalizePath(path);
	try {
		const { fs, path: resolvedPath } = resolveFS(path);
		return fs.exists(resolvedPath, cred);
	} catch (e) {
		if ((e as ApiError).errno == ErrorCode.ENOENT) {
			return false;
		}

		throw e;
	}
}

/**
 * `stat`.
 * @param path
 * @returns Stats
 */
export async function stat(path: PathLike, options: Node.BigIntOptions): Promise<BigIntStats>;
export async function stat(path: PathLike, options?: { bigint?: false }): Promise<Stats>;
export async function stat(path: PathLike, options?: Node.StatOptions): Promise<Stats | BigIntStats>;
export async function stat(path: PathLike, options?: Node.StatOptions): Promise<Stats | BigIntStats> {
	const stats: Stats = await doOp('stat', true, path, cred);
	return options?.bigint ? BigIntStats.clone(stats) : stats;
}
stat satisfies typeof Node.promises.stat;

/**
 * `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 * @return
 */
export async function lstat(path: PathLike, options?: { bigint?: false }): Promise<Stats>;
export async function lstat(path: PathLike, options: { bigint: true }): Promise<BigIntStats>;
export async function lstat(path: PathLike, options?: Node.StatOptions): Promise<Stats | BigIntStats> {
	const stats: Stats = await doOp('stat', false, path, cred);
	return options?.bigint ? BigIntStats.clone(stats) : stats;
}
lstat satisfies typeof Node.promises.lstat;

// FILE-ONLY METHODS

/**
 * `truncate`.
 * @param path
 * @param len
 */
export async function truncate(path: PathLike, len: number = 0): Promise<void> {
	if (len < 0) {
		throw new ApiError(ErrorCode.EINVAL);
	}
	return doOp('truncate', true, path, len, cred);
}
truncate satisfies typeof Node.promises.truncate;

/**
 * `unlink`.
 * @param path
 */
export async function unlink(path: PathLike): Promise<void> {
	return doOp('unlink', false, path, cred);
}
unlink satisfies typeof Node.promises.unlink;

/**{
		
	}
 * file open.
 * @see http://www.manpagez.com/man/2/open/
 * @param path
 * @param flags
 * @param mode defaults to `0644`
 */
export async function open(path: PathLike, flag: string, mode: Node.Mode = 0o644): Promise<FileHandle> {
	const file: File = await doOp('open', true, path, FileFlag.getFileFlag(flag), normalizeMode(mode, 0o644), cred);
	return new FileHandle(getFdForFile(file), path);
}
open satisfies BufferToUint8Array<typeof Node.promises.open>;

/**
 * Synchronously reads the entire contents of a file.
 * @param filename
 * @param options
 * options.encoding The string encoding for the file contents. Defaults to `null`.
 * options.flag Defaults to `'r'`.
 * @return Uint8Array
 */
export async function readFile(filename: PathLike, options?: { flag?: Node.OpenMode }): Promise<Uint8Array>;
export async function readFile(filename: PathLike, options: { encoding?: BufferEncoding; flag?: Node.OpenMode } | BufferEncoding): Promise<string>;
export async function readFile(filename: PathLike, _options?: { encoding?: BufferEncoding; flag?: Node.OpenMode } | BufferEncoding): Promise<Uint8Array | string> {
	const options = normalizeOptions(_options, null, 'r', null);
	const flag = FileFlag.getFileFlag(options.flag);
	if (!flag.isReadable()) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to readFile must allow for reading.');
	}
	const data: Uint8Array = await doOp('readFile', true, filename, flag, cred);
	switch (options.encoding) {
		case 'utf8':
		case 'utf-8':
			return decode(data);
		default:
			return data;
	}
}
readFile satisfies BufferToUint8Array<typeof Node.promises.readFile>;

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
export async function writeFile(filename: PathLike, data: FileContents, options?: { encoding?: BufferEncoding; mode?: Node.Mode; flag?: Node.OpenMode }): Promise<void>;
export async function writeFile(filename: PathLike, data: FileContents, encoding?: BufferEncoding): Promise<void>;
export async function writeFile(
	filename: PathLike,
	data: FileContents,
	options?: { encoding?: BufferEncoding; mode?: Node.Mode; flag?: Node.OpenMode } | BufferEncoding
): Promise<void>;
export async function writeFile(
	filename: PathLike,
	data: FileContents,
	arg3?: { encoding?: BufferEncoding; mode?: Node.Mode; flag?: Node.OpenMode } | BufferEncoding
): Promise<void> {
	const options = normalizeOptions(arg3, 'utf8', 'w', 0o644);
	const flag = FileFlag.getFileFlag(options.flag);
	if (!flag.isWriteable()) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to writeFile must allow for writing.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? encode(data) : data;
	return doOp('writeFile', true, filename, encodedData, flag, options.mode, cred);
}
writeFile satisfies typeof Node.promises.writeFile;

/**
 * Asynchronously append data to a file, creating the file if it not yet
 * exists.
 * @param filename
 * @param data
 * @param options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'a'`.
 */
export async function appendFile(
	filename: PathLike,
	data: FileContents,
	_options?: BufferEncoding | (Node.BaseEncodingOptions & { mode?: Node.Mode; flag?: Node.OpenMode })
): Promise<void> {
	const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
	const flag = FileFlag.getFileFlag(options.flag);
	if (!flag.isAppendable()) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? encode(data) : data;
	return doOp('appendFile', true, filename, encodedData, flag, options.mode, cred);
}
appendFile satisfies typeof Node.promises.appendFile;

// FILE DESCRIPTOR METHODS

/**
 * `fstat`.
 * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
 * specified by the file descriptor `fd`.
 * @param fd
 * @returns stats
 */
export async function fstat(fd: number, options?: { bigint?: false }): Promise<Stats>;
export async function fstat(fd: number, options: { bigint: true }): Promise<BigIntStats>;
export async function fstat(fd: number, options?: Node.StatOptions): Promise<Stats | BigIntStats> {
	const stats: Stats = await fd2file(fd).stat();
	return options?.bigint ? BigIntStats.clone(stats) : stats;
}

/**
 * close.
 * @param fd
 */
export async function close(fd: number): Promise<void> {
	await fd2file(fd).close();
	fdMap.delete(fd);
	return;
}

/**
 * ftruncate.
 * @param fd
 * @param len
 */
export async function ftruncate(fd: number, len: number = 0): Promise<void> {
	const file = fd2file(fd);
	if (len < 0) {
		throw new ApiError(ErrorCode.EINVAL);
	}
	return file.truncate(len);
}

/**
 * fsync.
 * @param fd
 */
export async function fsync(fd: number): Promise<void> {
	return fd2file(fd).sync();
}

/**
 * fdatasync.
 * @param fd
 */
export async function fdatasync(fd: number): Promise<void> {
	return fd2file(fd).datasync();
}

/**
 * Write buffer to the file specified by `fd`.
 * Note that it is unsafe to use fs.write multiple times on the same file without waiting for it to return.
 * @param handle
 * @param data Uint8Array containing the data to write to the file.
 * @param offset Offset in the buffer to start reading data from.
 * @param length The amount of bytes to write to the file.
 * @param position Offset from the beginning of the file where this data should be written. If position is null, the data will be written at the current position.
 */
export async function write(handle: FileHandle, data: Uint8Array, offset: number, length: number, position?: number): Promise<number>;
export async function write(handle: FileHandle, data: string, position?: number, encoding?: BufferEncoding): Promise<number>;
export async function write(handle: FileHandle, data: FileContents, posOrOff?: number, lenOrEnc?: BufferEncoding | number, position?: number): Promise<number> {
	const { bytesWritten } = await handle.write(data, posOrOff, lenOrEnc, position);
	return bytesWritten;
}
write satisfies BufferToUint8Array<typeof Node.promises.write>;

/**
 * Read data from the file specified by `fd`.
 * @param handle
 * @param buffer The buffer that the data will be
 *   written to.
 * @param offset The offset within the buffer where writing will
 *   start.
 * @param length An integer specifying the number of bytes to read.
 * @param position An integer specifying where to begin reading from
 *   in the file. If position is null, data will be read from the current file
 *   position.
 */
export async function read(handle: FileHandle, buffer: Uint8Array, offset: number, length: number, position?: number): Promise<{ bytesRead: number; buffer: Uint8Array }> {
	const file = fd2file(handle.fd);
	if (isNaN(+position)) {
		position = file.position!;
	}

	return file.read(buffer, offset, length, position);
}
read satisfies BufferToUint8Array<typeof Node.promises.read>;

/**
 * `fchown`.
 * @param handle
 * @param uid
 * @param gid
 */
export function fchown(handle: FileHandle, uid: number, gid: number): Promise<void> {
	return handle.chown(uid, gid);
}
fchown satisfies BufferToUint8Array<typeof Node.promises.fchown>;

/**
 * `fchmod`.
 * @param handle
 * @param mode
 */
export function fchmod(handle: FileHandle, mode: Node.Mode): Promise<void> {
	return handle.chmod(mode);
}
fchmod satisfies BufferToUint8Array<typeof Node.promises.fchmod>;

/**
 * Change the file timestamps of a file referenced by the supplied file
 * descriptor.
 * @param handle
 * @param atime
 * @param mtime
 */
export async function futimes(handle: FileHandle, atime: string | number | Date, mtime: string | number | Date): Promise<void> {
	return handle.utimes(atime, mtime);
}
futimes satisfies BufferToUint8Array<typeof Node.promises.futimes>;

// DIRECTORY-ONLY METHODS

/**
 * `rmdir`.
 * @param path
 */
export async function rmdir(path: PathLike): Promise<void> {
	return doOp('rmdir', true, path, cred);
}
rmdir satisfies typeof Node.promises.rmdir;

/**
 * `mkdir`.
 * @param path
 * @param mode defaults to `0777`
 */
export async function mkdir(path: PathLike, mode?: Node.Mode | (Node.MakeDirectoryOptions & { recursive?: false })): Promise<void>;
export async function mkdir(path: PathLike, mode: Node.MakeDirectoryOptions & { recursive: true }): Promise<string>;
export async function mkdir(path: PathLike, mode?: Node.Mode | Node.MakeDirectoryOptions): Promise<string | void> {
	return doOp('mkdir', true, path, normalizeMode(typeof mode == 'object' ? mode?.mode : mode, 0o777), cred);
}
mkdir satisfies typeof Node.promises.mkdir;

/**
 * `readdir`. Reads the contents of a directory.
 * @param path
 */
export async function readdir(path: PathLike, options?: (Node.BaseEncodingOptions & { withFileTypes?: false }) | BufferEncoding): Promise<string[]>;
export async function readdir(path: PathLike, options: Node.BufferEncodingOption & { withFileTypes?: false }): Promise<Uint8Array[]>;
export async function readdir(path: PathLike, options: Node.BaseEncodingOptions & { withFileTypes: true }): Promise<Dirent[]>;
export async function readdir(
	path: PathLike,
	options?: (Node.BaseEncodingOptions & { withFileTypes?: boolean }) | BufferEncoding | (Node.BufferEncodingOption & { withFileTypes?: boolean })
): Promise<string[] | Dirent[] | Uint8Array[]> {
	path = normalizePath(path);
	const entries: string[] = await doOp('readdir', true, path, cred);
	const points = [...mounts.keys()];
	for (const point of points) {
		if (point.startsWith(path)) {
			const entry = point.slice(path.length);
			if (entry.includes('/') || entry.length == 0) {
				// ignore FSs mounted in subdirectories and any FS mounted to `path`.
				continue;
			}
			entries.push(entry);
		}
	}
	const values: (string | Dirent)[] = [];
	for (const entry of entries) {
		values.push(typeof options == 'object' && options?.withFileTypes ? new Dirent(entry, await stat(join(path, entry))) : entry);
	}
	return values as string[] | Dirent[];
}
readdir satisfies BufferToUint8Array<typeof Node.promises.readdir>;

// SYMLINK METHODS

/**
 * `link`.
 * @param srcpath
 * @param dstpath
 */
export async function link(srcpath: PathLike, dstpath: PathLike): Promise<void> {
	dstpath = normalizePath(dstpath);
	return doOp('link', false, srcpath, dstpath, cred);
}
link satisfies typeof Node.promises.link;

/**
 * `symlink`.
 * @param srcpath
 * @param dstpath
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 */
export async function symlink(srcpath: PathLike, dstpath: PathLike, type: Node.symlink.Type = 'file'): Promise<void> {
	if (!['file', 'dir', 'junction'].includes(type)) {
		throw new ApiError(ErrorCode.EINVAL, 'Invalid type: ' + type);
	}
	dstpath = normalizePath(dstpath);
	return doOp('symlink', false, srcpath, dstpath, type, cred);
}
symlink satisfies typeof Node.promises.symlink;

/**
 * readlink.
 * @param path
 */
export async function readlink(path: PathLike, options: Node.BufferEncodingOption): Promise<Uint8Array>;
export async function readlink(path: PathLike, options?: Node.BaseEncodingOptions | BufferEncoding): Promise<string>;
export async function readlink(path: PathLike, options?: Node.BufferEncodingOption | Node.BaseEncodingOptions | BufferEncoding): Promise<string | Uint8Array> {
	const value: string = await doOp('readlink', false, path, cred);
	return encode(value, typeof options == 'object' ? options.encoding : options);
}
readlink satisfies BufferToUint8Array<typeof Node.promises.readlink>;

// PROPERTY OPERATIONS

/**
 * `chown`.
 * @param path
 * @param uid
 * @param gid
 */
export async function chown(path: PathLike, uid: number, gid: number): Promise<void> {
	return doOp('chown', true, path, uid, gid, cred);
}
chown satisfies typeof Node.promises.chown;

/**
 * `lchown`.
 * @param path
 * @param uid
 * @param gid
 */
export async function lchown(path: PathLike, uid: number, gid: number): Promise<void> {
	return doOp('chown', false, path, uid, gid, cred);
}
lchown satisfies typeof Node.promises.lchown;

/**
 * `chmod`.
 * @param path
 * @param mode
 */
export async function chmod(path: PathLike, mode: string | number): Promise<void> {
	const numMode = normalizeMode(mode, -1);
	if (numMode < 0) {
		throw new ApiError(ErrorCode.EINVAL, `Invalid mode.`);
	}
	return doOp('chmod', true, path, numMode, cred);
}
chmod satisfies typeof Node.promises.chmod;

/**
 * `lchmod`.
 * @param path
 * @param mode
 */
export async function lchmod(path: PathLike, mode: number | string): Promise<void> {
	const numMode = normalizeMode(mode, -1);
	if (numMode < 1) {
		throw new ApiError(ErrorCode.EINVAL, `Invalid mode.`);
	}
	return doOp('chmod', false, normalizePath(path), numMode, cred);
}
lchmod satisfies typeof Node.promises.lchmod;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export async function utimes(path: PathLike, atime: number | Date, mtime: number | Date): Promise<void> {
	return doOp('utimes', true, path, normalizeTime(atime), normalizeTime(mtime), cred);
}
utimes satisfies typeof Node.promises.utimes;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export async function lutimes(path: PathLike, atime: number | Date, mtime: number | Date): Promise<void> {
	return doOp('utimes', false, path, normalizeTime(atime), normalizeTime(mtime), cred);
}
lutimes satisfies typeof Node.promises.lutimes;

/**
 * Asynchronous realpath(3) - return the canonicalized absolute pathname.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 *
 * Note: This *Can not* use doOp since doOp depends on it
 */
export async function realpath(path: PathLike, options: Node.BufferEncodingOption): Promise<Uint8Array>;
export async function realpath(path: PathLike, options?: Node.BaseEncodingOptions | BufferEncoding): Promise<string>;
export async function realpath(path: PathLike, options?: Node.BaseEncodingOptions | BufferEncoding | Node.BufferEncodingOption): Promise<string | Uint8Array> {
	path = normalizePath(path);
	const { fs, path: resolvedPath, mountPoint } = resolveFS(path);
	try {
		const stats = await fs.stat(resolvedPath, cred);
		if (!stats.isSymbolicLink()) {
			return path;
		}
		const dst = mountPoint + normalizePath(await fs.readlink(resolvedPath, cred));
		return realpath(dst);
	} catch (e) {
		throw fixError(e, { [resolvedPath]: path });
	}
}
realpath satisfies BufferToUint8Array<typeof Node.promises.realpath>;

export async function watchFile(filename: PathLike, listener: (curr: Stats, prev: Stats) => void): Promise<void>;
export async function watchFile(filename: PathLike, options: { persistent?: boolean; interval?: number }, listener: (curr: Stats, prev: Stats) => void): Promise<void>;
export async function watchFile(filename: PathLike, arg2: any, listener: (curr: Stats, prev: Stats) => void = nop): Promise<void> {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export async function unwatchFile(filename: PathLike, listener: (curr: Stats, prev: Stats) => void = nop): Promise<void> {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export async function watch(filename: PathLike, listener?: (event: string, filename: PathLike) => any): Promise<Node.FSWatcher>;
export async function watch(filename: PathLike, options: { persistent?: boolean }, listener?: (event: string, filename: string) => any): Promise<Node.FSWatcher>;
export async function watch(filename: PathLike, arg2: any, listener: (event: string, filename: string) => any = nop): Promise<Node.FSWatcher> {
	throw new ApiError(ErrorCode.ENOTSUP);
}

/**
 * `access`.
 * @param path
 * @param mode
 */
export async function access(path: PathLike, mode: number = 0o600): Promise<void> {
	const stats = await stat(path);
	if (!stats.hasAccess(mode, cred)) {
		throw new ApiError(ErrorCode.EACCES);
	}
}

export async function createReadStream(
	path: PathLike,
	options?: {
		flags?: string;
		encoding?: string;
		fd?: number;
		mode?: number;
		autoClose?: boolean;
	}
): Promise<Node.ReadStream> {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export async function createWriteStream(
	path: PathLike,
	options?: {
		flags?: string;
		encoding?: string;
		fd?: number;
		mode?: number;
	}
): Promise<Node.WriteStream> {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export async function rm(path: PathLike) {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export async function mkdtemp(path: PathLike) {
	throw new ApiError(ErrorCode.ENOTSUP);
}

export async function copyFile(path: PathLike) {
	throw new ApiError(ErrorCode.ENOTSUP);
}
