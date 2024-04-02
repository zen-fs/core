import type * as Node from 'node:fs';
import { ApiError, ErrorCode } from '../ApiError.js';
export * as constants from './constants.js';
import { ActionType, File, isReadable, isWriteable, isAppendable, parseFlag, pathExistsAction, pathNotExistsAction } from '../file.js';
import { normalizePath, normalizeMode, getFdForFile, normalizeOptions, fd2file, fdMap, normalizeTime, cred, nop, resolveFS, fixError, mounts } from './shared.js';
import type { PathLike, BufferToUint8Array } from './shared.js';
import { FileContents, FileSystem } from '../filesystem.js';
import { BigIntStats, FileType, type Stats } from '../stats.js';
import { decode, encode } from '../utils.js';
import { Dirent } from './dir.js';
import { dirname, join } from './path.js';

export class FileHandle implements BufferToUint8Array<Node.promises.FileHandle> {
	public constructor(
		/**
		 * Gets the file descriptor for this file handle.
		 */
		public readonly fd: number
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
		const numMode = normalizeMode(mode, -1);
		if (numMode < 0) {
			throw new ApiError(ErrorCode.EINVAL, 'Invalid mode.');
		}
		return fd2file(this.fd).chmod(numMode);
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
		if (len < 0) {
			throw new ApiError(ErrorCode.EINVAL);
		}
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
	 * @param _options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
	 * If `encoding` is not supplied, the default of `'utf8'` is used.
	 * If `mode` is not supplied, the default of `0o666` is used.
	 * If `mode` is a string, it is parsed as an octal integer.
	 * If `flag` is not supplied, the default of `'a'` is used.
	 */
	public async appendFile(data: string | Uint8Array, _options?: { encoding?: BufferEncoding; mode?: Node.Mode; flag?: Node.OpenMode } | BufferEncoding): Promise<void> {
		const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
		const flag = parseFlag(options.flag);
		if (!isAppendable(flag)) {
			throw new ApiError(ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.');
		}
		if (typeof data != 'string' && !options.encoding) {
			throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
		}
		const encodedData = typeof data == 'string' ? encode(data) : data;
		await fd2file(this.fd).write(encodedData, 0, encodedData.length, null);
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
		if (isNaN(+position)) {
			position = fd2file(this.fd).position!;
		}
		return fd2file(this.fd).read(buffer, offset, length, position);
	}

	/**
	 * Asynchronously reads the entire contents of a file. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for reading.
	 * @param _options An object that may contain an optional flag.
	 * If a flag is not provided, it defaults to `'r'`.
	 */
	public async readFile(_options?: { flag?: Node.OpenMode }): Promise<Uint8Array>;
	public async readFile(_options: { encoding: BufferEncoding; flag?: Node.OpenMode } | BufferEncoding): Promise<string>;
	public async readFile(_options?: { encoding?: BufferEncoding; flag?: Node.OpenMode } | BufferEncoding): Promise<string | Uint8Array> {
		const options = normalizeOptions(_options, null, 'r', null);
		const flag = parseFlag(options.flag);
		if (!isReadable(flag)) {
			throw new ApiError(ErrorCode.EINVAL, 'Flag passed must allow for reading.');
		}

		const { size } = await this.stat();
		const data = new Uint8Array(size);
		await fd2file(this.fd).read(data, 0, size, 0);
		return options.encoding ? decode(data, options.encoding) : data;
	}

	/**
	 * Asynchronous fstat(2) - Get file status.
	 */
	public async stat(opts: Node.BigIntOptions): Promise<BigIntStats>;
	public async stat(opts?: Node.StatOptions & { bigint?: false }): Promise<Stats>;
	public async stat(opts?: Node.StatOptions): Promise<Stats | BigIntStats> {
		const stats = await fd2file(this.fd).stat();
		return opts.bigint ? new BigIntStats(stats) : stats;
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

		position ??= fd2file(this.fd).position!;
		const bytesWritten = await fd2file(this.fd).write(buffer, offset, length, position);
		return { buffer, bytesWritten };
	}

	/**
	 * Asynchronously writes data to a file, replacing the file if it already exists. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for writing.
	 * It is unsafe to call `writeFile()` multiple times on the same file without waiting for the `Promise` to be resolved (or rejected).
	 * @param data The data to write. If something other than a `Buffer` or `Uint8Array` is provided, the value is coerced to a string.
	 * @param _options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
	 * If `encoding` is not supplied, the default of `'utf8'` is used.
	 * If `mode` is not supplied, the default of `0o666` is used.
	 * If `mode` is a string, it is parsed as an octal integer.
	 * If `flag` is not supplied, the default of `'w'` is used.
	 */
	async writeFile(data: string | Uint8Array, _options?: Node.WriteFileOptions): Promise<void> {
		const options = normalizeOptions(_options, 'utf8', 'w', 0o644);
		const flag = parseFlag(options.flag);
		if (!isWriteable(flag)) {
			throw new ApiError(ErrorCode.EINVAL, 'Flag passed must allow for writing.');
		}
		if (typeof data != 'string' && !options.encoding) {
			throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
		}
		const encodedData = typeof data == 'string' ? encode(data, options.encoding) : data;
		await fd2file(this.fd).write(encodedData, 0, encodedData.length, 0);
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
	async close(): Promise<void> {
		await fd2file(this.fd).close();
		fdMap.delete(this.fd);
	}
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
async function doOp<M extends FileSystemMethod, RT extends ReturnType<M> = ReturnType<M>>(...[name, resolveSymlinks, rawPath, ...args]: Parameters<M>): Promise<RT> {
	rawPath = normalizePath(rawPath);
	const { fs, path } = resolveFS(resolveSymlinks && (await exists(rawPath)) ? await realpath(rawPath) : rawPath);
	try {
		// @ts-expect-error 2556 (since ...args is not correctly picked up as being a tuple)
		return fs[name](path, ...args) as Promise<RT>;
	} catch (e) {
		throw fixError(e, { [path]: rawPath });
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
	const { path: old } = resolveFS(oldPath);
	const { fs, path } = resolveFS(newPath);
	try {
		const data = await readFile(oldPath);
		await writeFile(newPath, data);
		await unlink(oldPath);
	} catch (e) {
		throw fixError(e, { [old]: oldPath, [path]: newPath });
	}
}
rename satisfies typeof Node.promises.rename;

/**
 * Test whether or not the given path exists by checking with the file system.
 * @param _path
 */
export async function exists(_path: PathLike): Promise<boolean> {
	try {
		const { fs, path } = resolveFS(_path);
		return fs.exists(path, cred);
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
	return options?.bigint ? new BigIntStats(stats) : stats;
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
	return options?.bigint ? new BigIntStats(stats) : stats;
}
lstat satisfies typeof Node.promises.lstat;

// FILE-ONLY METHODS

/**
 * `truncate`.
 * @param path
 * @param len
 */
export async function truncate(path: PathLike, len: number = 0): Promise<void> {
	const handle = await open(path, 'r+');
	try {
		await handle.truncate(len);
	} finally {
		await handle.close();
	}
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

/**
 * Opens a file. This helper handles the complexity of file flags.
 * @internal
 */
async function _open(_path: PathLike, _flag: string, _mode: Node.Mode = 0o644, resolveSymlinks: boolean): Promise<File> {
	const path = normalizePath(_path),
		mode = normalizeMode(_mode, 0o644),
		flag = parseFlag(_flag);

	try {
		switch (pathExistsAction(flag)) {
			case ActionType.THROW:
				throw ApiError.EEXIST(path);
			case ActionType.TRUNCATE:
				/* 
					In a previous implementation, we deleted the file and
					re-created it. However, this created a race condition if another
					asynchronous request was trying to read the file, as the file
					would not exist for a small period of time.
				*/
				const file: File = await doOp('openFile', resolveSymlinks, path, flag, cred);
				if (!file) {
					throw new ApiError(ErrorCode.EIO, 'Impossible code path reached');
				}
				await file.truncate(0);
				await file.sync();
				return file;
			case ActionType.NOP:
				// Must await so thrown errors are caught by the catch below
				return await doOp('openFile', resolveSymlinks, path, flag, cred);
			default:
				throw new ApiError(ErrorCode.EINVAL, 'Invalid file flag');
		}
	} catch (e) {
		switch (pathNotExistsAction(flag)) {
			case ActionType.CREATE:
				// Ensure parent exists.
				const parentStats: Stats = await doOp('stat', resolveSymlinks, dirname(path), cred);
				if (parentStats && !parentStats.isDirectory()) {
					throw ApiError.ENOTDIR(dirname(path));
				}
				return await doOp('createFile', resolveSymlinks, path, flag, mode, cred);
			case ActionType.THROW:
				throw ApiError.ENOENT(path);
			default:
				throw new ApiError(ErrorCode.EINVAL, 'Invalid file flag');
		}
	}
}

/**
 * Asynchronous file open.
 * @see http://www.manpagez.com/man/2/open/
 * @param flags Handles the complexity of the various file modes. See its API for more details.
 * @param mode Mode to use to open the file. Can be ignored if the filesystem doesn't support permissions.
 */
export async function open(path: PathLike, flag: string, mode: Node.Mode = 0o644): Promise<FileHandle> {
	const file = await _open(path, flag, mode, true);
	return new FileHandle(getFdForFile(file));
}
open satisfies BufferToUint8Array<typeof Node.promises.open>;

/**
 * Opens a file without resolving symlinks
 * @internal
 */
export async function lopen(path: PathLike, flag: string, mode: Node.Mode = 0o644): Promise<FileHandle> {
	const file: File = await _open(path, flag, mode, false);
	return new FileHandle(getFdForFile(file));
}

/**
 * Asynchronously reads the entire contents of a file.
 */
async function _readFile(fname: string, flag: string, resolveSymlinks: boolean): Promise<Uint8Array> {
	const file = await _open(normalizePath(fname), flag, 0o644, resolveSymlinks);

	try {
		const stat = await file.stat();
		const data = new Uint8Array(stat.size);
		await file.read(data, 0, stat.size, 0);
		await file.close();
		return data;
	} catch (e) {
		await file.close();
		throw e;
	}
}

/**
 * Asynchronously reads the entire contents of a file.
 * @param filename
 * @param options
 * options.encoding The string encoding for the file contents. Defaults to `null`.
 * options.flag Defaults to `'r'`.
 * @returns file data
 */
export async function readFile(filename: PathLike, options?: { flag?: Node.OpenMode }): Promise<Uint8Array>;
export async function readFile(filename: PathLike, options: { encoding?: BufferEncoding; flag?: Node.OpenMode } | BufferEncoding): Promise<string>;
export async function readFile(filename: PathLike, _options?: { encoding?: BufferEncoding; flag?: Node.OpenMode } | BufferEncoding): Promise<Uint8Array | string> {
	const options = normalizeOptions(_options, null, 'r', null);
	const flag = parseFlag(options.flag);
	if (!isReadable(flag)) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed must allow for reading.');
	}

	const data: Uint8Array = await _readFile(filename, options.flag, true);
	return options.encoding ? decode(data, options.encoding) : data;
}
readFile satisfies BufferToUint8Array<typeof Node.promises.readFile>;

/**
 * Synchronously writes data to a file, replacing the file if it already exists.
 *
 * The encoding option is ignored if data is a buffer.
 * @param filename
 * @param data
 * @param _options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'w'`.
 */
export async function writeFile(filename: PathLike, data: FileContents, _options?: Node.WriteFileOptions): Promise<void> {
	const options = normalizeOptions(_options, 'utf8', 'w', 0o644);
	const handle = await open(filename, options.flag, options.mode);
	try {
		await handle.writeFile(data, options);
	} finally {
		await handle.close();
	}
}
writeFile satisfies typeof Node.promises.writeFile;

/**
 * Asynchronously append data to a file, creating the file if
 * it not yet exists.
 */
async function _appendFile(fname: string, data: Uint8Array, flag: string, mode: number, resolveSymlinks: boolean): Promise<void> {
	const file = await _open(fname, flag, mode, resolveSymlinks);
	try {
		await file.write(data, 0, data.length, null);
	} finally {
		await file.close();
	}
}

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
	const flag = parseFlag(options.flag);
	if (!isAppendable(flag)) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? encode(data) : data;
	await _appendFile(filename, encodedData, options.flag, options.mode, true);
}
appendFile satisfies typeof Node.promises.appendFile;

/**
 * Write buffer to the file specified by `fd`.
 * Note that it is unsafe to use fs.write multiple times on the same file without waiting for it to return.
 * @param handle
 * @param data Uint8Array containing the data to write to the file.
 * @param offset Offset in the buffer to start reading data from.
 * @param length The amount of bytes to write to the file.
 * @param position Offset from the beginning of the file where this data should be written. If position is null, the data will be written at the current position.
 */
export function write(handle: FileHandle, data: Uint8Array, offset: number, length: number, position?: number): Promise<{ bytesWritten: number; buffer: Uint8Array }>;
export function write(handle: FileHandle, data: string, position?: number, encoding?: BufferEncoding): Promise<{ bytesWritten: number; buffer: string }>;
export function write(
	handle: FileHandle,
	data: FileContents,
	posOrOff?: number,
	lenOrEnc?: BufferEncoding | number,
	position?: number
): Promise<{ bytesWritten: number; buffer: FileContents }> {
	return handle.write(data, posOrOff, lenOrEnc, position);
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
export function read(handle: FileHandle, buffer: Uint8Array, offset: number, length: number, position?: number): Promise<{ bytesRead: number; buffer: Uint8Array }> {
	return handle.read(buffer, offset, length, position);
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
export function futimes(handle: FileHandle, atime: string | number | Date, mtime: string | number | Date): Promise<void> {
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
	await doOp('mkdir', true, path, normalizeMode(typeof mode == 'object' ? mode?.mode : mode, 0o777), cred);
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
 * @param existing
 * @param newpath
 */
export async function link(existing: PathLike, newpath: PathLike): Promise<void> {
	newpath = normalizePath(newpath);
	return doOp('link', false, existing, newpath, cred);
}
link satisfies typeof Node.promises.link;

/**
 * `symlink`.
 * @param target target path
 * @param path link path
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 */
export async function symlink(target: PathLike, path: PathLike, type: Node.symlink.Type = 'file'): Promise<void> {
	if (!['file', 'dir', 'junction'].includes(type)) {
		throw new ApiError(ErrorCode.EINVAL, 'Invalid symlink type: ' + type);
	}

	if (await exists(path)) {
		throw ApiError.EEXIST(path);
	}

	await writeFile(path, target);
	const file = await _open(path, 'r+', 0o644, false);
	await file._setType(FileType.SYMLINK);
}
symlink satisfies typeof Node.promises.symlink;

/**
 * readlink.
 * @param path
 */
export async function readlink(path: PathLike, options: Node.BufferEncodingOption): Promise<Uint8Array>;
export async function readlink(path: PathLike, options?: Node.BaseEncodingOptions | BufferEncoding): Promise<string>;
export async function readlink(path: PathLike, options?: Node.BufferEncodingOption | Node.BaseEncodingOptions | BufferEncoding): Promise<string | Uint8Array> {
	const value: Uint8Array = await _readFile(path, 'r', false);
	const encoding: BufferEncoding | 'buffer' = typeof options == 'object' ? options.encoding : options;
	if (encoding == 'buffer') {
		return value;
	}
	return decode(value, encoding);
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
	const handle = await open(path, 'r+');
	try {
		await handle.chown(uid, gid);
	} finally {
		await handle.close();
	}
}
chown satisfies typeof Node.promises.chown;

/**
 * `lchown`.
 * @param path
 * @param uid
 * @param gid
 */
export async function lchown(path: PathLike, uid: number, gid: number): Promise<void> {
	const handle = await lopen(path, 'r+');
	try {
		await handle.chown(uid, gid);
	} finally {
		await handle.close();
	}
}
lchown satisfies typeof Node.promises.lchown;

/**
 * `chmod`.
 * @param path
 * @param mode
 */
export async function chmod(path: PathLike, mode: Node.Mode): Promise<void> {
	const handle = await open(path, 'r+');
	try {
		await handle.chmod(mode);
	} finally {
		await handle.close();
	}
}
chmod satisfies typeof Node.promises.chmod;

/**
 * `lchmod`.
 * @param path
 * @param mode
 */
export async function lchmod(path: PathLike, mode: Node.Mode): Promise<void> {
	const handle = await lopen(path, 'r+');
	try {
		await handle.chmod(mode);
	} finally {
		await handle.close();
	}
}
lchmod satisfies typeof Node.promises.lchmod;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export async function utimes(path: PathLike, atime: string | number | Date, mtime: string | number | Date): Promise<void> {
	const handle = await open(path, 'r+');
	try {
		await handle.utimes(atime, mtime);
	} finally {
		await handle.close();
	}
}
utimes satisfies typeof Node.promises.utimes;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export async function lutimes(path: PathLike, atime: number | Date, mtime: number | Date): Promise<void> {
	const handle = await lopen(path, 'r+');
	try {
		await handle.utimes(atime, mtime);
	} finally {
		await handle.close();
	}
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
		const dst = mountPoint + normalizePath(decode(await _readFile(resolvedPath, 'r+', false)));
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
