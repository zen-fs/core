import { Buffer } from 'buffer';
import type * as fs from 'node:fs';
import type * as promises from 'node:fs/promises';
import type { CreateReadStreamOptions, CreateWriteStreamOptions, FileChangeInfo, FileReadResult, FlagAndOpenMode } from 'node:fs/promises';
import type { ReadableStream as TReadableStream } from 'node:stream/web';
import type { Interface as ReadlineInterface } from 'readline';
import type { ReadableStreamController } from 'stream/web';
import { ApiError, ErrorCode } from '../ApiError.js';
import { ActionType, File, isAppendable, isReadable, isWriteable, parseFlag, pathExistsAction, pathNotExistsAction } from '../file.js';
import { FileContents, FileSystem } from '../filesystem.js';
import { BigIntStats, FileType, type BigIntStatsFs, type Stats, type StatsFs } from '../stats.js';
import { normalizeMode, normalizeOptions, normalizePath, normalizeTime } from '../utils.js';
import * as constants from './constants.js';
import { Dir, Dirent } from './dir.js';
import { dirname, join, parse } from './path.js';
import { cred, fd2file, fdMap, fixError, file2fd, mounts, resolveMount } from './shared.js';
import { ReadStream, WriteStream } from './streams.js';
import type { Stream } from 'node:stream';
export * as constants from './constants.js';

export class FileHandle implements promises.FileHandle {
	public constructor(
		/**
		 * Gets the file descriptor for this file handle.
		 */
		public readonly fd: number
	) {}

	/**
	 * @internal
	 */
	public get file(): File {
		return fd2file(this.fd);
	}

	/**
	 * Asynchronous fchown(2) - Change ownership of a file.
	 */
	public chown(uid: number, gid: number): Promise<void> {
		return this.file.chown(uid, gid);
	}

	/**
	 * Asynchronous fchmod(2) - Change permissions of a file.
	 * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
	 */
	public chmod(mode: fs.Mode): Promise<void> {
		const numMode = normalizeMode(mode, -1);
		if (numMode < 0) {
			throw new ApiError(ErrorCode.EINVAL, 'Invalid mode.');
		}
		return this.file.chmod(numMode);
	}

	/**
	 * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
	 */
	public datasync(): Promise<void> {
		return this.file.datasync();
	}

	/**
	 * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
	 */
	public sync(): Promise<void> {
		return this.file.sync();
	}

	/**
	 * Asynchronous ftruncate(2) - Truncate a file to a specified length.
	 * @param len If not specified, defaults to `0`.
	 */
	public truncate(len?: number | null): Promise<void> {
		len ||= 0;
		if (len < 0) {
			throw new ApiError(ErrorCode.EINVAL);
		}
		return this.file.truncate(len);
	}

	/**
	 * Asynchronously change file timestamps of the file.
	 * @param atime The last access time. If a string is provided, it will be coerced to number.
	 * @param mtime The last modified time. If a string is provided, it will be coerced to number.
	 */
	public utimes(atime: string | number | Date, mtime: string | number | Date): Promise<void> {
		return this.file.utimes(normalizeTime(atime), normalizeTime(mtime));
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
	public async appendFile(data: string | Uint8Array, _options: (fs.ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding = {}): Promise<void> {
		const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
		const flag = parseFlag(options.flag);
		if (!isAppendable(flag)) {
			throw new ApiError(ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.');
		}
		if (typeof data != 'string' && !options.encoding) {
			throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
		}
		const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : data;
		await this.file.write(encodedData, 0, encodedData.length, null);
	}

	/**
	 * Asynchronously reads data from the file.
	 * The `FileHandle` must have been opened for reading.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset in the buffer at which to start writing.
	 * @param length The number of bytes to read.
	 * @param position The offset from the beginning of the file from which data should be read. If `null`, data will be read from the current position.
	 */
	public read<TBuffer extends NodeJS.ArrayBufferView>(
		buffer: TBuffer,
		offset?: number,
		length?: number,
		position: number = this.file.position
	): Promise<FileReadResult<TBuffer>> {
		if (isNaN(+position)) {
			position = this.file.position;
		}
		return this.file.read(buffer, offset, length, position);
	}

	/**
	 * Asynchronously reads the entire contents of a file. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for reading.
	 * @param _options An object that may contain an optional flag.
	 * If a flag is not provided, it defaults to `'r'`.
	 */
	public async readFile(_options?: { flag?: fs.OpenMode }): Promise<Buffer>;
	public async readFile(_options: (fs.ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding): Promise<string>;
	public async readFile(_options: (fs.ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding = {}): Promise<string | Buffer> {
		const options = normalizeOptions(_options, null, 'r', 0o444);
		const flag = parseFlag(options.flag);
		if (!isReadable(flag)) {
			throw new ApiError(ErrorCode.EINVAL, 'Flag passed must allow for reading.');
		}

		const { size } = await this.stat();
		const data = new Uint8Array(size);
		await this.file.read(data, 0, size, 0);
		const buffer = Buffer.from(data);
		return options.encoding ? buffer.toString(options.encoding) : buffer;
	}

	/**
	 * Returns a `ReadableStream` that may be used to read the files data.
	 *
	 * An error will be thrown if this method is called more than once or is called after the `FileHandle` is closed
	 * or closing.
	 *
	 * While the `ReadableStream` will read the file to completion, it will not close the `FileHandle` automatically. User code must still call the `fileHandle.close()` method.
	 *
	 * @since v17.0.0
	 * @experimental
	 */
	public readableWebStream(options: promises.ReadableWebStreamOptions = {}): TReadableStream<Uint8Array> {
		// Note: using an arrow function to preserve `this`
		const start = async ({ close, enqueue, error }: ReadableStreamController<Uint8Array>) => {
			try {
				const chunkSize = 64 * 1024,
					maxChunks = 1e7;
				let i = 0,
					position = 0,
					bytesRead = NaN;

				while (bytesRead > 0) {
					const result = await this.read(new Uint8Array(chunkSize), 0, chunkSize, position);
					if (!result.bytesRead) {
						close();
						return;
					}
					enqueue(result.buffer.slice(0, result.bytesRead));
					position += result.bytesRead;
					if (++i >= maxChunks) {
						throw new ApiError(ErrorCode.EFBIG, 'Too many iterations on readable stream', this.file.path, 'FileHandle.readableWebStream');
					}
					bytesRead = result.bytesRead;
				}
			} catch (e) {
				error(e);
			}
		};

		return new (globalThis as any).ReadableStream({ start, type: options.type });
	}

	public readLines(options?: promises.CreateReadStreamOptions): ReadlineInterface {
		throw ApiError.With('ENOSYS', this.file.path, 'FileHandle.readLines');
	}

	public [Symbol.asyncDispose](): Promise<void> {
		return this.close();
	}

	/**
	 * Asynchronous fstat(2) - Get file status.
	 */
	public async stat(opts: fs.BigIntOptions): Promise<BigIntStats>;
	public async stat(opts?: fs.StatOptions & { bigint?: false }): Promise<Stats>;
	public async stat(opts?: fs.StatOptions): Promise<Stats | BigIntStats> {
		const stats = await this.file.stat();
		return opts?.bigint ? new BigIntStats(stats) : stats;
	}

	public async write(data: FileContents, posOrOff?: number, lenOrEnc?: BufferEncoding | number, position?: number): Promise<{ bytesWritten: number; buffer: FileContents }>;

	/**
	 * Asynchronously writes `buffer` to the file.
	 * The `FileHandle` must have been opened for writing.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
	 * @param length The number of bytes to write. If not supplied, defaults to `buffer.length - offset`.
	 * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
	 */
	public async write<TBuffer extends Uint8Array>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{ bytesWritten: number; buffer: TBuffer }>;

	/**
	 * Asynchronously writes `string` to the file.
	 * The `FileHandle` must have been opened for writing.
	 * It is unsafe to call `write()` multiple times on the same file without waiting for the `Promise`
	 * to be resolved (or rejected). For this scenario, `fs.createWriteStream` is strongly recommended.
	 * @param string A string to write.
	 * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
	 * @param encoding The expected string encoding.
	 */
	public async write(data: string, position?: number, encoding?: BufferEncoding): Promise<{ bytesWritten: number; buffer: string }>;

	public async write(
		data: FileContents,
		posOrOff?: number,
		lenOrEnc?: BufferEncoding | number,
		position?: number | null
	): Promise<{ bytesWritten: number; buffer: FileContents }> {
		let buffer: Uint8Array, offset: number | null | undefined, length: number;
		if (typeof data === 'string') {
			// Signature 1: (fd, string, [position?, [encoding?]])
			position = typeof posOrOff === 'number' ? posOrOff : null;
			const encoding = <BufferEncoding>(typeof lenOrEnc === 'string' ? lenOrEnc : 'utf8');
			offset = 0;
			buffer = Buffer.from(data, encoding);
			length = buffer.length;
		} else {
			// Signature 2: (fd, buffer, offset, length, position?)
			buffer = new Uint8Array(data.buffer);
			offset = posOrOff;
			length = lenOrEnc as number;
			position = typeof position === 'number' ? position : null;
		}

		position ??= this.file.position!;
		const bytesWritten = await this.file.write(buffer, offset, length, position);
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
	public async writeFile(data: string | Uint8Array, _options: fs.WriteFileOptions = {}): Promise<void> {
		const options = normalizeOptions(_options, 'utf8', 'w', 0o644);
		const flag = parseFlag(options.flag);
		if (!isWriteable(flag)) {
			throw new ApiError(ErrorCode.EINVAL, 'Flag passed must allow for writing.');
		}
		if (typeof data != 'string' && !options.encoding) {
			throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
		}
		const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : data;
		await this.file.write(encodedData, 0, encodedData.length, 0);
	}

	/**
	 * Asynchronous close(2) - close a `FileHandle`.
	 */
	public async close(): Promise<void> {
		await this.file.close();
		fdMap.delete(this.fd);
	}

	/**
	 * Asynchronous `writev`. Writes from multiple buffers.
	 * @param buffers An array of Uint8Array buffers.
	 * @param position The position in the file where to begin writing.
	 * @returns The number of bytes written.
	 */
	public async writev(buffers: Uint8Array[], position?: number): Promise<fs.WriteVResult> {
		let bytesWritten = 0;

		for (const buffer of buffers) {
			bytesWritten += (await this.write(buffer, 0, buffer.length, position! + bytesWritten)).bytesWritten;
		}

		return { bytesWritten, buffers };
	}

	/**
	 * Asynchronous `readv`. Reads into multiple buffers.
	 * @param buffers An array of Uint8Array buffers.
	 * @param position The position in the file where to begin reading.
	 * @returns The number of bytes read.
	 */
	public async readv(buffers: NodeJS.ArrayBufferView[], position?: number): Promise<fs.ReadVResult> {
		let bytesRead = 0;

		for (const buffer of buffers) {
			bytesRead += (await this.read(buffer, 0, buffer.byteLength, position! + bytesRead)).bytesRead;
		}

		return { bytesRead, buffers };
	}

	/**
	 * Creates a `ReadStream` for reading from the file.
	 *
	 * @param options Options for the readable stream
	 * @returns A `ReadStream` object.
	 */
	public createReadStream(options?: CreateReadStreamOptions): ReadStream {
		const stream = new ReadStream({
			highWaterMark: options?.highWaterMark || 64 * 1024,
			encoding: options!.encoding!,

			read: async (size: number) => {
				try {
					const result = await this.read(new Uint8Array(size), 0, size, this.file.position);
					stream.push(!result.bytesRead ? null : result.buffer.slice(0, result.bytesRead)); // Push data or null for EOF
					this.file.position += result.bytesRead;
				} catch (error) {
					stream.destroy(<Error>error);
				}
			},
		});

		stream.path = this.file.path;
		return stream;
	}

	/**
	 * Creates a `WriteStream` for writing to the file.
	 *
	 * @param options Options for the writeable stream.
	 * @returns A `WriteStream` object
	 */
	public createWriteStream(options?: CreateWriteStreamOptions): WriteStream {
		const streamOptions = {
			highWaterMark: options?.highWaterMark,
			encoding: options?.encoding,

			write: async (chunk: Uint8Array, encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
				try {
					const { bytesWritten } = await this.write(chunk, undefined, encoding);
					callback(bytesWritten == chunk.length ? null : new Error('Failed to write full chunk'));
				} catch (error) {
					callback(<Error>error);
				}
			},
		};

		const stream = new WriteStream(streamOptions);
		stream.path = this.file.path;
		return stream;
	}
}

type FileSystemMethod = {
	[K in keyof FileSystem]: FileSystem[K] extends (...args: any[]) => unknown
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
	rawPath = normalizePath(rawPath!);
	const _path = resolveSymlinks && (await exists(rawPath)) ? await realpath(rawPath) : rawPath;
	const { fs, path } = resolveMount(_path);
	try {
		// @ts-expect-error 2556 (since ...args is not correctly picked up as being a tuple)
		return fs[name](path, ...args) as Promise<RT>;
	} catch (e) {
		throw fixError(<Error>e, { [path]: rawPath });
	}
}

// fs.promises

/**
 * Renames a file
 * @param oldPath
 * @param newPath
 */
export async function rename(oldPath: fs.PathLike, newPath: fs.PathLike): Promise<void> {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const src = resolveMount(oldPath);
	const dst = resolveMount(newPath);
	try {
		if (src.mountPoint == dst.mountPoint) {
			await src.fs.rename(src.path, dst.path, cred);
			return;
		}
		await writeFile(newPath, await readFile(oldPath));
		await unlink(oldPath);
	} catch (e) {
		throw fixError(<Error>e, { [src.path]: oldPath, [dst.path]: newPath });
	}
}
rename satisfies typeof promises.rename;

/**
 * Test whether or not the given path exists by checking with the file system.
 * @param _path
 */
export async function exists(_path: fs.PathLike): Promise<boolean> {
	try {
		const { fs, path } = resolveMount(await realpath(_path));
		return await fs.exists(path, cred);
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
export async function stat(path: fs.PathLike, options: fs.BigIntOptions): Promise<BigIntStats>;
export async function stat(path: fs.PathLike, options?: { bigint?: false }): Promise<Stats>;
export async function stat(path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats>;
export async function stat(path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats> {
	const stats: Stats = await doOp('stat', true, path.toString(), cred);
	return options?.bigint ? new BigIntStats(stats) : stats;
}
stat satisfies typeof promises.stat;

/**
 * `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 * @return
 */
export async function lstat(path: fs.PathLike, options?: { bigint?: boolean }): Promise<Stats>;
export async function lstat(path: fs.PathLike, options: { bigint: true }): Promise<BigIntStats>;
export async function lstat(path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats> {
	const stats: Stats = await doOp('stat', false, path.toString(), cred);
	return options?.bigint ? new BigIntStats(stats) : stats;
}
lstat satisfies typeof promises.lstat;

// FILE-ONLY METHODS

/**
 * `truncate`.
 * @param path
 * @param len
 */
export async function truncate(path: fs.PathLike, len: number = 0): Promise<void> {
	const handle = await open(path, 'r+');
	try {
		await handle.truncate(len);
	} finally {
		await handle.close();
	}
}
truncate satisfies typeof promises.truncate;

/**
 * `unlink`.
 * @param path
 */
export async function unlink(path: fs.PathLike): Promise<void> {
	return doOp('unlink', false, path.toString(), cred);
}
unlink satisfies typeof promises.unlink;

/**
 * Opens a file. This helper handles the complexity of file flags.
 * @internal
 */
async function _open(_path: fs.PathLike, _flag: fs.OpenMode, _mode: fs.Mode = 0o644, resolveSymlinks: boolean): Promise<File> {
	const path = normalizePath(_path),
		mode = normalizeMode(_mode, 0o644),
		flag = parseFlag(_flag);

	try {
		switch (pathExistsAction(flag)) {
			case ActionType.THROW:
				throw ApiError.With('EEXIST', path, '_open');
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
					throw ApiError.With('ENOTDIR', dirname(path), '_open');
				}
				return await doOp('createFile', resolveSymlinks, path, flag, mode, cred);
			case ActionType.THROW:
				throw ApiError.With('ENOENT', path, '_open');
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
export async function open(path: fs.PathLike, flag: fs.OpenMode = 'r', mode: fs.Mode = 0o644): Promise<FileHandle> {
	const file = await _open(path, flag, mode, true);
	return new FileHandle(file2fd(file));
}
open satisfies typeof promises.open;

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
export async function readFile(path: fs.PathLike | promises.FileHandle, options?: { encoding?: null; flag?: fs.OpenMode } | null): Promise<Buffer>;
export async function readFile(path: fs.PathLike | promises.FileHandle, options: { encoding: BufferEncoding; flag?: fs.OpenMode } | BufferEncoding): Promise<string>;
export async function readFile(
	path: fs.PathLike | promises.FileHandle,
	options?: (fs.ObjectEncodingOptions & { flag?: fs.OpenMode }) | BufferEncoding | null
): Promise<string | Buffer>;
export async function readFile(
	path: fs.PathLike | promises.FileHandle,
	_options?: (fs.ObjectEncodingOptions & { flag?: fs.OpenMode }) | BufferEncoding | null
): Promise<Buffer | string> {
	const options = normalizeOptions(_options, null, 'r', 0);
	const flag = parseFlag(options.flag);
	if (!isReadable(flag)) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed must allow for reading.');
	}
	path = path instanceof FileHandle ? path.file.path : path.toString();
	const data: Buffer = Buffer.from(await _readFile(path, options.flag, true));
	return options.encoding ? data.toString(options.encoding) : data;
}
readFile satisfies typeof promises.readFile;

/**
 * Asynchronously writes data to a file, replacing the file if it already exists.
 *
 * The encoding option is ignored if data is a buffer.
 * @param path
 * @param data Note:
 * @param _options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'w'`.
 */
export async function writeFile(
	path: fs.PathLike | promises.FileHandle,
	data: FileContents | Stream | Iterable<string | ArrayBufferView> | AsyncIterable<string | ArrayBufferView>,
	_options?: (fs.ObjectEncodingOptions & { mode?: fs.Mode; flag?: fs.OpenMode; flush?: boolean }) | BufferEncoding | null
): Promise<void> {
	const options = normalizeOptions(_options, 'utf8', 'w+', 0o644);
	const handle = path instanceof FileHandle ? path : await open(path.toString(), options.flag, options.mode);
	try {
		const _data = typeof data == 'string' ? data : data instanceof Uint8Array ? new Uint8Array(data.buffer) : null;
		if (!_data) {
			throw new ApiError(ErrorCode.EINVAL, 'Iterables and streams not supported', handle.file.path, 'writeFile');
		}
		await handle.writeFile(_data, options);
	} finally {
		await handle.close();
	}
}
writeFile satisfies typeof promises.writeFile;

/**
 * Asynchronously append data to a file, creating the file if
 * it not yet exists.
 */
async function _appendFile(path: fs.PathLike, data: Uint8Array, flag: string, mode: number, resolveSymlinks: boolean): Promise<void> {
	const file = await _open(path, flag, mode, resolveSymlinks);
	try {
		await file.write(data, 0, data.length, undefined);
	} finally {
		await file.close();
	}
}

/**
 * Asynchronously append data to a file, creating the file if it not yet
 * exists.
 * @param path
 * @param data
 * @param options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'a'`.
 */
export async function appendFile(
	path: fs.PathLike | promises.FileHandle,
	data: FileContents,
	_options?: BufferEncoding | (fs.EncodingOption & { mode?: fs.Mode; flag?: fs.OpenMode }) | null
): Promise<void> {
	const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
	const flag = parseFlag(options.flag);
	if (!isAppendable(flag)) {
		throw new ApiError(ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ApiError(ErrorCode.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : new Uint8Array(data.buffer);
	await _appendFile(path instanceof FileHandle ? path.file.path : path.toString(), encodedData, options.flag, options.mode, true);
}
appendFile satisfies typeof promises.appendFile;

// DIRECTORY-ONLY METHODS

/**
 * `rmdir`.
 * @param path
 */
export async function rmdir(path: fs.PathLike): Promise<void> {
	return doOp('rmdir', true, path.toString(), cred);
}
rmdir satisfies typeof promises.rmdir;

/**
 * Asynchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
export async function mkdir(path: fs.PathLike, options: fs.MakeDirectoryOptions & { recursive: true }): Promise<string | undefined>;
export async function mkdir(path: fs.PathLike, options?: fs.Mode | (fs.MakeDirectoryOptions & { recursive?: false | undefined }) | null): Promise<void>;
export async function mkdir(path: fs.PathLike, options?: fs.Mode | fs.MakeDirectoryOptions | null): Promise<string | undefined>;
export async function mkdir(path: fs.PathLike, options?: fs.Mode | fs.MakeDirectoryOptions | null): Promise<string | undefined | void> {
	await doOp('mkdir', true, path.toString(), normalizeMode(typeof options == 'object' ? options?.mode : options, 0o777), cred);
	return;
}
mkdir satisfies typeof promises.mkdir;

/**
 * Asynchronous readdir(3) - read a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 */
export async function readdir(path: fs.PathLike, options?: (fs.ObjectEncodingOptions & { withFileTypes?: false; recursive?: boolean }) | BufferEncoding | null): Promise<string[]>;
export async function readdir(path: fs.PathLike, options: fs.BufferEncodingOption & { withFileTypes?: false; recursive?: boolean }): Promise<Buffer[]>;
export async function readdir(
	path: fs.PathLike,
	options?: (fs.ObjectEncodingOptions & { withFileTypes?: false; recursive?: boolean }) | BufferEncoding | null
): Promise<string[] | Buffer[]>;
export async function readdir(path: fs.PathLike, options: fs.ObjectEncodingOptions & { withFileTypes: true; recursive?: boolean }): Promise<Dirent[]>;
export async function readdir(
	path: fs.PathLike,
	options?: { withFileTypes?: boolean; recursive?: boolean; encoding?: BufferEncoding | 'buffer' | null } | BufferEncoding | 'buffer' | null
): Promise<string[] | Dirent[] | Buffer[]> {
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
readdir satisfies typeof promises.readdir;

// SYMLINK METHODS

/**
 * `link`.
 * @param existing
 * @param newpath
 */
export async function link(existing: fs.PathLike, newpath: fs.PathLike): Promise<void> {
	newpath = normalizePath(newpath);
	return doOp('link', false, existing.toString(), newpath, cred);
}
link satisfies typeof promises.link;

/**
 * `symlink`.
 * @param target target path
 * @param path link path
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 */
export async function symlink(target: fs.PathLike, path: fs.PathLike, type: fs.symlink.Type | string | null = 'file'): Promise<void> {
	if (!['file', 'dir', 'junction'].includes(type!)) {
		throw new ApiError(ErrorCode.EINVAL, 'Invalid symlink type: ' + type);
	}

	if (await exists(path)) {
		throw ApiError.With('EEXIST', path.toString(), 'symlink');
	}

	await writeFile(path, target.toString());
	const file = await _open(path, 'r+', 0o644, false);
	await file._setType(FileType.SYMLINK);
}
symlink satisfies typeof promises.symlink;

/**
 * readlink.
 * @param path
 */
export async function readlink(path: fs.PathLike, options: fs.BufferEncodingOption): Promise<Buffer>;
export async function readlink(path: fs.PathLike, options?: fs.EncodingOption | null): Promise<string>;
export async function readlink(path: fs.PathLike, options?: fs.BufferEncodingOption | fs.EncodingOption | string | null): Promise<string | Buffer>;
export async function readlink(path: fs.PathLike, options?: fs.BufferEncodingOption | fs.EncodingOption | string | null): Promise<string | Buffer> {
	const value: Buffer = Buffer.from(await _readFile(path.toString(), 'r', false));
	const encoding = typeof options == 'object' ? options?.encoding : options;
	if (encoding == 'buffer') {
		return value;
	}
	return value.toString(encoding! as BufferEncoding);
}
readlink satisfies typeof promises.readlink;

// PROPERTY OPERATIONS

/**
 * `chown`.
 * @param path
 * @param uid
 * @param gid
 */
export async function chown(path: fs.PathLike, uid: number, gid: number): Promise<void> {
	const handle = await open(path, 'r+');
	try {
		await handle.chown(uid, gid);
	} finally {
		await handle.close();
	}
}
chown satisfies typeof promises.chown;

/**
 * `lchown`.
 * @param path
 * @param uid
 * @param gid
 */
export async function lchown(path: fs.PathLike, uid: number, gid: number): Promise<void> {
	const file: File = await _open(path, 'r+', 0o644, false);
	try {
		await file.chown(uid, gid);
	} finally {
		await file.close();
	}
}
lchown satisfies typeof promises.lchown;

/**
 * `chmod`.
 * @param path
 * @param mode
 */
export async function chmod(path: fs.PathLike, mode: fs.Mode): Promise<void> {
	const handle = await open(path, 'r+');
	try {
		await handle.chmod(mode);
	} finally {
		await handle.close();
	}
}
chmod satisfies typeof promises.chmod;

/**
 * `lchmod`.
 * @param path
 * @param mode
 */
export async function lchmod(path: fs.PathLike, mode: fs.Mode): Promise<void> {
	const file: File = await _open(path, 'r+', 0o644, false);
	try {
		await new FileHandle(file2fd(file)).chmod(mode);
	} finally {
		await file.close();
	}
}
lchmod satisfies typeof promises.lchmod;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export async function utimes(path: fs.PathLike, atime: string | number | Date, mtime: string | number | Date): Promise<void> {
	const handle = await open(path, 'r+');
	try {
		await handle.utimes(atime, mtime);
	} finally {
		await handle.close();
	}
}
utimes satisfies typeof promises.utimes;

/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export async function lutimes(path: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike): Promise<void> {
	const file: File = await _open(path, 'r+', 0o644, false);
	try {
		await file.utimes(new Date(atime), new Date(mtime));
	} finally {
		await file.close();
	}
}
lutimes satisfies typeof promises.lutimes;

/**
 * Asynchronous realpath(3) - return the canonicalized absolute pathname.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 *
 * Note: This *Can not* use doOp since doOp depends on it
 */
export async function realpath(path: fs.PathLike, options: fs.BufferEncodingOption): Promise<Buffer>;
export async function realpath(path: fs.PathLike, options?: fs.EncodingOption | BufferEncoding): Promise<string>;
export async function realpath(path: fs.PathLike, options?: fs.EncodingOption | BufferEncoding | fs.BufferEncodingOption): Promise<string | Buffer> {
	path = normalizePath(path);
	const { base, dir } = parse(path);
	const lpath = join(dir == '/' ? '/' : await realpath(dir), base);
	const { fs, path: resolvedPath, mountPoint } = resolveMount(lpath);

	try {
		const stats = await fs.stat(resolvedPath, cred);
		if (!stats.isSymbolicLink()) {
			return lpath;
		}

		return realpath(mountPoint + (await readlink(lpath)));
	} catch (e) {
		throw fixError(<Error>e, { [resolvedPath]: lpath });
	}
}
realpath satisfies typeof promises.realpath;

/**
 * @todo Implement
 */
export function watch(filename: fs.PathLike, options?: fs.WatchOptions | BufferEncoding): AsyncIterable<FileChangeInfo<string>>;
export function watch(filename: fs.PathLike, options: fs.WatchOptions | fs.BufferEncodingOption): AsyncIterable<FileChangeInfo<Buffer>>;
export function watch(filename: fs.PathLike, options?: fs.WatchOptions | string): AsyncIterable<FileChangeInfo<string>> | AsyncIterable<FileChangeInfo<Buffer>>;
export function watch(filename: fs.PathLike, options: fs.WatchOptions | string = {}): AsyncIterable<FileChangeInfo<string>> | AsyncIterable<FileChangeInfo<Buffer>> {
	throw ApiError.With('ENOSYS', filename.toString(), 'watch');
}
watch satisfies typeof promises.watch;

/**
 * `access`.
 * @param path
 * @param mode
 */
export async function access(path: fs.PathLike, mode: number = constants.F_OK): Promise<void> {
	const stats = await stat(path);
	if (!stats.hasAccess(mode, cred)) {
		throw new ApiError(ErrorCode.EACCES);
	}
}
access satisfies typeof promises.access;

/**
 * Asynchronous `rm`. Removes files or directories (recursively).
 * @param path The path to the file or directory to remove.
 */
export async function rm(path: fs.PathLike, options?: fs.RmOptions) {
	path = normalizePath(path);

	const stats = await stat(path);

	switch (stats.mode & constants.S_IFMT) {
		case constants.S_IFDIR:
			if (options?.recursive) {
				for (const entry of await readdir(path)) {
					await rm(join(path, entry));
				}
			}

			await rmdir(path);
			return;
		case constants.S_IFREG:
		case constants.S_IFLNK:
			await unlink(path);
			return;
		case constants.S_IFBLK:
		case constants.S_IFCHR:
		case constants.S_IFIFO:
		case constants.S_IFSOCK:
		default:
			throw new ApiError(ErrorCode.EPERM, 'File type not supported', path, 'rm');
	}
}
rm satisfies typeof promises.rm;

/**
 * Asynchronous `mkdtemp`. Creates a unique temporary directory.
 * @param prefix The directory prefix.
 * @param options The encoding (or an object including `encoding`).
 * @returns The path to the created temporary directory, encoded as a string or buffer.
 */
export async function mkdtemp(prefix: string, options?: fs.EncodingOption): Promise<string>;
export async function mkdtemp(prefix: string, options?: fs.BufferEncodingOption): Promise<Buffer>;
export async function mkdtemp(prefix: string, options?: fs.EncodingOption | fs.BufferEncodingOption): Promise<string | Buffer> {
	const encoding = typeof options === 'object' ? options?.encoding : options || 'utf8';
	const fsName = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const resolvedPath = '/tmp/' + fsName;

	await mkdir(resolvedPath);

	return encoding == 'buffer' ? Buffer.from(resolvedPath) : resolvedPath;
}
mkdtemp satisfies typeof promises.mkdtemp;

/**
 * Asynchronous `copyFile`. Copies a file.
 * @param src The source file.
 * @param dest The destination file.
 * @param mode Optional flags for the copy operation. Currently supports these flags:
 *    * `fs.constants.COPYFILE_EXCL`: If the destination file already exists, the operation fails.
 */
export async function copyFile(src: fs.PathLike, dest: fs.PathLike, mode?: number): Promise<void> {
	src = normalizePath(src);
	dest = normalizePath(dest);

	if (mode && mode & constants.COPYFILE_EXCL && (await exists(dest))) {
		throw new ApiError(ErrorCode.EEXIST, 'Destination file already exists.', dest, 'copyFile');
	}

	await writeFile(dest, await readFile(src));
}
copyFile satisfies typeof promises.copyFile;

/**
 * Asynchronous `opendir`. Opens a directory.
 * @param path The path to the directory.
 * @param options Options for opening the directory.
 * @returns A `Dir` object representing the opened directory.
 */
export async function opendir(path: fs.PathLike, options?: fs.OpenDirOptions): Promise<Dir> {
	path = normalizePath(path);
	return new Dir(path);
}
opendir satisfies typeof promises.opendir;

/**
 * Asynchronous `cp`. Recursively copies a file or directory.
 * @param source The source file or directory.
 * @param destination The destination file or directory.
 * @param opts Options for the copy operation. Currently supports these options from Node.js 'fs.await cp':
 *   * `dereference`: Dereference symbolic links.
 *   * `errorOnExist`: Throw an error if the destination file or directory already exists.
 *   * `filter`: A function that takes a source and destination path and returns a boolean, indicating whether to copy the given source element.
 *   * `force`: Overwrite the destination if it exists, and overwrite existing readonly destination files.
 *   * `preserveTimestamps`: Preserve file timestamps.
 *   * `recursive`: If `true`, copies directories recursively.
 */
export async function cp(source: fs.PathLike, destination: fs.PathLike, opts?: fs.CopyOptions): Promise<void> {
	source = normalizePath(source);
	destination = normalizePath(destination);

	const srcStats = await lstat(source); // Use lstat to follow symlinks if not dereferencing

	if (opts?.errorOnExist && (await exists(destination))) {
		throw new ApiError(ErrorCode.EEXIST, 'Destination file or directory already exists.', destination, 'cp');
	}

	switch (srcStats.mode & constants.S_IFMT) {
		case constants.S_IFDIR:
			if (!opts?.recursive) {
				throw new ApiError(ErrorCode.EISDIR, source + ' is a directory (not copied)', source, 'cp');
			}
			await mkdir(destination, { recursive: true }); // Ensure the destination directory exists
			for (const dirent of await readdir(source, { withFileTypes: true })) {
				if (opts.filter && !opts.filter(join(source, dirent.name), join(destination, dirent.name))) {
					continue; // Skip if the filter returns false
				}
				await cp(join(source, dirent.name), join(destination, dirent.name), opts);
			}
			break;
		case constants.S_IFREG:
		case constants.S_IFLNK:
			await copyFile(source, destination);
			break;
		case constants.S_IFBLK:
		case constants.S_IFCHR:
		case constants.S_IFIFO:
		case constants.S_IFSOCK:
		default:
			throw new ApiError(ErrorCode.EPERM, 'File type not supported', source, 'rm');
	}

	// Optionally preserve timestamps
	if (opts?.preserveTimestamps) {
		await utimes(destination, srcStats.atime, srcStats.mtime);
	}
}
cp satisfies typeof promises.cp;

/**
 * @since v18.15.0
 * @return Fulfills with an {fs.StatFs} for the file system.
 */
export async function statfs(path: fs.PathLike, opts?: fs.StatFsOptions & { bigint?: false }): Promise<StatsFs>;
export async function statfs(path: fs.PathLike, opts: fs.StatFsOptions & { bigint: true }): Promise<BigIntStatsFs>;
export async function statfs(path: fs.PathLike, opts?: fs.StatFsOptions): Promise<StatsFs | BigIntStatsFs>;
export async function statfs(path: fs.PathLike, opts?: fs.StatFsOptions): Promise<StatsFs | BigIntStatsFs> {
	throw ApiError.With('ENOSYS', path.toString(), 'statfs');
}
