/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { Buffer } from 'buffer';
import type * as fs from 'node:fs';
import type * as promises from 'node:fs/promises';
import type { CreateReadStreamOptions, CreateWriteStreamOptions, FileChangeInfo, FileReadResult, FlagAndOpenMode } from 'node:fs/promises';
import type { Stream } from 'node:stream';
import type { ReadableStream as TReadableStream } from 'node:stream/web';
import type { Interface as ReadlineInterface } from 'readline';
import type { ReadableStreamController } from 'stream/web';
import { Errno, ErrnoError } from '../error.js';
import type { File } from '../file.js';
import { flagToMode, isAppendable, isExclusive, isReadable, isTruncating, isWriteable, parseFlag } from '../file.js';
import type { FileContents } from '../filesystem.js';
import '../polyfills.js';
import { BigIntStats, type Stats } from '../stats.js';
import { normalizeMode, normalizeOptions, normalizePath, normalizeTime } from '../utils.js';
import * as constants from './constants.js';
import { Dir, Dirent } from './dir.js';
import { dirname, join, parse } from './path.js';
import { _statfs, fd2file, fdMap, file2fd, fixError, mounts, resolveMount } from './shared.js';
import { ReadStream, WriteStream } from './streams.js';
import { FSWatcher, emitChange } from './watchers.js';
export * as constants from './constants.js';

export class FileHandle implements promises.FileHandle {
	/**
	 * The file descriptor for this file handle.
	 */
	public readonly fd: number;

	/**
	 * @internal
	 * The file for this file handle
	 */
	public readonly file: File;

	public constructor(fdOrFile: number | File) {
		const isFile = typeof fdOrFile != 'number';
		this.fd = isFile ? file2fd(fdOrFile) : fdOrFile;
		this.file = isFile ? fdOrFile : fd2file(fdOrFile);
	}

	/**
	 * Asynchronous fchown(2) - Change ownership of a file.
	 */
	public async chown(uid: number, gid: number): Promise<void> {
		await this.file.chown(uid, gid);
		emitChange('change', this.file.path);
	}

	/**
	 * Asynchronous fchmod(2) - Change permissions of a file.
	 * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
	 */
	public async chmod(mode: fs.Mode): Promise<void> {
		const numMode = normalizeMode(mode, -1);
		if (numMode < 0) {
			throw new ErrnoError(Errno.EINVAL, 'Invalid mode.');
		}
		await this.file.chmod(numMode);
		emitChange('change', this.file.path);
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
	 * @param length If not specified, defaults to `0`.
	 */
	public async truncate(length?: number | null): Promise<void> {
		length ||= 0;
		if (length < 0) {
			throw new ErrnoError(Errno.EINVAL);
		}
		await this.file.truncate(length);
		emitChange('change', this.file.path);
	}

	/**
	 * Asynchronously change file timestamps of the file.
	 * @param atime The last access time. If a string is provided, it will be coerced to number.
	 * @param mtime The last modified time. If a string is provided, it will be coerced to number.
	 */
	public async utimes(atime: string | number | Date, mtime: string | number | Date): Promise<void> {
		await this.file.utimes(normalizeTime(atime), normalizeTime(mtime));
		emitChange('change', this.file.path);
	}

	/**
	 * Asynchronously append data to a file, creating the file if it does not exist. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for appending.
	 * @param data The data to write. If something other than a `Buffer` or `Uint8Array` is provided, the value is coerced to a string.
	 * @param _options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
	 * - `encoding` defaults to `'utf8'`.
	 * - `mode` defaults to `0o666`.
	 * - `flag` defaults to `'a'`.
	 */
	public async appendFile(data: string | Uint8Array, _options: (fs.ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding = {}): Promise<void> {
		const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
		const flag = parseFlag(options.flag);
		if (!isAppendable(flag)) {
			throw new ErrnoError(Errno.EINVAL, 'Flag passed to appendFile must allow for appending.');
		}
		if (typeof data != 'string' && !options.encoding) {
			throw new ErrnoError(Errno.EINVAL, 'Encoding not specified');
		}
		const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : data;
		await this.file.write(encodedData, 0, encodedData.length);
		emitChange('change', this.file.path);
	}

	/**
	 * Asynchronously reads data from the file.
	 * The `FileHandle` must have been opened for reading.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset in the buffer at which to start writing.
	 * @param length The number of bytes to read.
	 * @param position The offset from the beginning of the file from which data should be read. If `null`, data will be read from the current position.
	 */
	public read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number | null): Promise<FileReadResult<TBuffer>> {
		if (isNaN(+position!)) {
			position = this.file.position;
		}
		return this.file.read(buffer, offset, length, position!);
	}

	/**
	 * Asynchronously reads the entire contents of a file. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for reading.
	 * @param _options An object that may contain an optional flag.
	 * If a flag is not provided, it defaults to `'r'`.
	 */
	public async readFile(_options?: { flag?: fs.OpenMode }): Promise<Buffer>;
	public async readFile(_options: (fs.ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding): Promise<string>;
	public async readFile(_options?: (fs.ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding): Promise<string | Buffer> {
		const options = normalizeOptions(_options, null, 'r', 0o444);
		const flag = parseFlag(options.flag);
		if (!isReadable(flag)) {
			throw new ErrnoError(Errno.EINVAL, 'Flag passed must allow for reading.');
		}

		const { size } = await this.stat();
		const { buffer: data } = await this.file.read(new Uint8Array(size), 0, size, 0);
		const buffer = Buffer.from(data);
		return options.encoding ? buffer.toString(options.encoding) : buffer;
	}

	/**
	 * Returns a `ReadableStream` that may be used to read the files data.
	 *
	 * An error will be thrown if this method is called more than once or is called after the `FileHandle` is closed or closing.
	 *
	 * While the `ReadableStream` will read the file to completion,
	 * it will not close the `FileHandle` automatically.
	 * User code must still call the `fileHandle.close()` method.
	 *
	 * @since v17.0.0
	 * @experimental
	 */
	public readableWebStream(options: promises.ReadableWebStreamOptions = {}): TReadableStream<Uint8Array> {
		// Note: using an arrow function to preserve `this`
		const start = async (controller: ReadableStreamController<Uint8Array>) => {
			try {
				const chunkSize = 64 * 1024,
					maxChunks = 1e7;
				let i = 0,
					position = 0,
					bytesRead = NaN;

				while (bytesRead > 0) {
					const result = await this.read(new Uint8Array(chunkSize), 0, chunkSize, position);
					if (!result.bytesRead) {
						controller.close();
						return;
					}
					controller.enqueue(result.buffer.slice(0, result.bytesRead));
					position += result.bytesRead;
					if (++i >= maxChunks) {
						throw new ErrnoError(Errno.EFBIG, 'Too many iterations on readable stream', this.file.path, 'FileHandle.readableWebStream');
					}
					bytesRead = result.bytesRead;
				}
			} catch (e) {
				controller.error(e);
			}
		};

		const _gt = globalThis;
		if (!('ReadableStream' in _gt)) {
			throw new ErrnoError(Errno.ENOSYS, 'ReadableStream is missing on globalThis');
		}
		return new (_gt as { ReadableStream: new (...args: unknown[]) => TReadableStream<Uint8Array> }).ReadableStream({ start, type: options.type });
	}

	public readLines(options?: promises.CreateReadStreamOptions): ReadlineInterface {
		throw ErrnoError.With('ENOSYS', this.file.path, 'FileHandle.readLines');
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
		if (!stats.hasAccess(constants.R_OK)) {
			throw ErrnoError.With('EACCES', this.file.path, 'stat');
		}
		return opts?.bigint ? new BigIntStats(stats) : stats;
	}

	/**
	 * Asynchronously writes `string` to the file.
	 * The `FileHandle` must have been opened for writing.
	 * It is unsafe to call `write()` multiple times on the same file without waiting for the `Promise`
	 * to be resolved (or rejected). For this scenario, `fs.createWriteStream` is strongly recommended.
	 */
	public async write(
		data: FileContents,
		posOrOff?: number | null,
		lenOrEnc?: BufferEncoding | number,
		position?: number | null
	): Promise<{ bytesWritten: number; buffer: FileContents }>;
	public async write<TBuffer extends Uint8Array>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{ bytesWritten: number; buffer: TBuffer }>;
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
			const encoding = typeof lenOrEnc === 'string' ? lenOrEnc : ('utf8' as BufferEncoding);
			offset = 0;
			buffer = Buffer.from(data, encoding);
			length = buffer.length;
		} else {
			// Signature 2: (fd, buffer, offset, length, position?)
			buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			offset = posOrOff;
			length = lenOrEnc as number;
			position = typeof position === 'number' ? position : null;
		}
		position ??= this.file.position;
		const bytesWritten = await this.file.write(buffer, offset, length, position);
		emitChange('change', this.file.path);
		return { buffer, bytesWritten };
	}

	/**
	 * Asynchronously writes data to a file, replacing the file if it already exists. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for writing.
	 * It is unsafe to call `writeFile()` multiple times on the same file without waiting for the `Promise` to be resolved (or rejected).
	 * @param data The data to write. If something other than a `Buffer` or `Uint8Array` is provided, the value is coerced to a string.
	 * @param _options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
	 * - `encoding` defaults to `'utf8'`.
	 * - `mode` defaults to `0o666`.
	 * - `flag` defaults to `'w'`.
	 */
	public async writeFile(data: string | Uint8Array, _options: fs.WriteFileOptions = {}): Promise<void> {
		const options = normalizeOptions(_options, 'utf8', 'w', 0o644);
		const flag = parseFlag(options.flag);
		if (!isWriteable(flag)) {
			throw new ErrnoError(Errno.EINVAL, 'Flag passed must allow for writing.');
		}
		if (typeof data != 'string' && !options.encoding) {
			throw new ErrnoError(Errno.EINVAL, 'Encoding not specified');
		}
		const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : data;
		await this.file.write(encodedData, 0, encodedData.length, 0);
		emitChange('change', this.file.path);
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
	 * Creates a stream for reading from the file.
	 * @param options Options for the readable stream
	 */
	public createReadStream(options?: CreateReadStreamOptions): ReadStream {
		const stream = new ReadStream({
			highWaterMark: options?.highWaterMark || 64 * 1024,
			encoding: options!.encoding!,

			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			read: async (size: number) => {
				try {
					const result = await this.read(new Uint8Array(size), 0, size, this.file.position);
					stream.push(!result.bytesRead ? null : result.buffer.slice(0, result.bytesRead)); // Push data or null for EOF
					this.file.position += result.bytesRead;
				} catch (error) {
					stream.destroy(error as Error);
				}
			},
		});

		stream.path = this.file.path;
		return stream;
	}

	/**
	 * Creates a stream for writing to the file.
	 * @param options Options for the writeable stream.
	 */
	public createWriteStream(options?: CreateWriteStreamOptions): WriteStream {
		const streamOptions = {
			highWaterMark: options?.highWaterMark,
			encoding: options?.encoding,

			write: async (chunk: Uint8Array, encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
				try {
					const { bytesWritten } = await this.write(chunk, null, encoding);
					callback(bytesWritten == chunk.length ? null : new Error('Failed to write full chunk'));
				} catch (error) {
					callback(error as Error);
				}
			},
		};

		const stream = new WriteStream(streamOptions);
		stream.path = this.file.path;
		return stream;
	}
}

export async function rename(oldPath: fs.PathLike, newPath: fs.PathLike): Promise<void> {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const src = resolveMount(oldPath);
	const dst = resolveMount(newPath);
	if (!(await stat(dirname(oldPath))).hasAccess(constants.W_OK)) {
		throw ErrnoError.With('EACCES', oldPath, 'rename');
	}
	try {
		if (src.mountPoint == dst.mountPoint) {
			await src.fs.rename(src.path, dst.path);
			emitChange('rename', oldPath.toString());
			return;
		}
		await writeFile(newPath, await readFile(oldPath));
		await unlink(oldPath);
		emitChange('rename', oldPath.toString());
	} catch (e) {
		throw fixError(e as Error, { [src.path]: oldPath, [dst.path]: newPath });
	}
}
rename satisfies typeof promises.rename;

/**
 * Test whether or not `path` exists by checking with the file system.
 */
export async function exists(path: fs.PathLike): Promise<boolean> {
	try {
		const { fs, path: resolved } = resolveMount(await realpath(path));
		return await fs.exists(resolved);
	} catch (e) {
		if (e instanceof ErrnoError && e.code == 'ENOENT') {
			return false;
		}

		throw e;
	}
}

export async function stat(path: fs.PathLike, options: fs.BigIntOptions): Promise<BigIntStats>;
export async function stat(path: fs.PathLike, options?: { bigint?: false }): Promise<Stats>;
export async function stat(path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats>;
export async function stat(path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount((await exists(path)) ? await realpath(path) : path);
	try {
		const stats = await fs.stat(resolved);
		if (!stats.hasAccess(constants.R_OK)) {
			throw ErrnoError.With('EACCES', path, 'stat');
		}
		return options?.bigint ? new BigIntStats(stats) : stats;
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
}
stat satisfies typeof promises.stat;

/**
 * `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 */
export async function lstat(path: fs.PathLike, options?: { bigint?: boolean }): Promise<Stats>;
export async function lstat(path: fs.PathLike, options: { bigint: true }): Promise<BigIntStats>;
export async function lstat(path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path);
	try {
		const stats = await fs.stat(resolved);
		return options?.bigint ? new BigIntStats(stats) : stats;
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
}
lstat satisfies typeof promises.lstat;

// FILE-ONLY METHODS

export async function truncate(path: fs.PathLike, len: number = 0): Promise<void> {
	await using handle = await open(path, 'r+');
	await handle.truncate(len);
}
truncate satisfies typeof promises.truncate;

export async function unlink(path: fs.PathLike): Promise<void> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path);
	try {
		if (!(await fs.stat(resolved)).hasAccess(constants.W_OK)) {
			throw ErrnoError.With('EACCES', resolved, 'unlink');
		}
		await fs.unlink(resolved);
		emitChange('rename', path.toString());
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
}
unlink satisfies typeof promises.unlink;

/**
 * Opens a file. This helper handles the complexity of file flags.
 * @internal
 */
async function _open(path: fs.PathLike, _flag: fs.OpenMode, _mode: fs.Mode = 0o644, resolveSymlinks: boolean): Promise<FileHandle> {
	path = normalizePath(path);
	const mode = normalizeMode(_mode, 0o644),
		flag = parseFlag(_flag);

	path = resolveSymlinks && (await exists(path)) ? await realpath(path) : path;
	const { fs, path: resolved } = resolveMount(path);

	const stats = await fs.stat(resolved).catch(() => null);

	if (!stats) {
		if ((!isWriteable(flag) && !isAppendable(flag)) || flag == 'r+') {
			throw ErrnoError.With('ENOENT', path, '_open');
		}
		// Create the file
		const parentStats: Stats = await fs.stat(dirname(resolved));
		if (!parentStats.hasAccess(constants.W_OK)) {
			throw ErrnoError.With('EACCES', dirname(path), '_open');
		}
		if (!parentStats.isDirectory()) {
			throw ErrnoError.With('ENOTDIR', dirname(path), '_open');
		}
		return new FileHandle(await fs.createFile(resolved, flag, mode));
	}

	if (!stats.hasAccess(flagToMode(flag))) {
		throw ErrnoError.With('EACCES', path, '_open');
	}

	if (isExclusive(flag)) {
		throw ErrnoError.With('EEXIST', path, '_open');
	}

	const handle = new FileHandle(await fs.openFile(resolved, flag));

	/*
		In a previous implementation, we deleted the file and
		re-created it. However, this created a race condition if another
		asynchronous request was trying to read the file, as the file
		would not exist for a small period of time.
	*/
	if (isTruncating(flag)) {
		await handle.truncate(0);
		await handle.sync();
	}

	return handle;
}

/**
 * Asynchronous file open.
 * @see http://www.manpagez.com/man/2/open/
 * @param flag Handles the complexity of the various file modes. See its API for more details.
 * @param mode Mode to use to open the file. Can be ignored if the filesystem doesn't support permissions.
 */
export async function open(path: fs.PathLike, flag: fs.OpenMode = 'r', mode: fs.Mode = 0o644): Promise<FileHandle> {
	return await _open(path, flag, mode, true);
}
open satisfies typeof promises.open;

/**
 * Asynchronously reads the entire contents of a file.
 * @option encoding The string encoding for the file contents. Defaults to `null`.
 * @option flag Defaults to `'r'`.
 * @returns the file data
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
	const options = normalizeOptions(_options, null, 'r', 0o644);
	await using handle: FileHandle | promises.FileHandle = typeof path == 'object' && 'fd' in path ? path : await open(path as string, options.flag, options.mode);
	return await handle.readFile(options);
}
readFile satisfies typeof promises.readFile;

/**
 * Asynchronously writes data to a file, replacing the file if it already exists.
 *
 * The encoding option is ignored if data is a buffer.
 * @option encoding Defaults to `'utf8'`.
 * @option mode Defaults to `0644`.
 * @option flag Defaults to `'w'`.
 */
export async function writeFile(
	path: fs.PathLike | promises.FileHandle,
	data: FileContents | Stream | Iterable<string | ArrayBufferView> | AsyncIterable<string | ArrayBufferView>,
	_options?: (fs.ObjectEncodingOptions & { mode?: fs.Mode; flag?: fs.OpenMode; flush?: boolean }) | BufferEncoding | null
): Promise<void> {
	const options = normalizeOptions(_options, 'utf8', 'w+', 0o644);
	await using handle = path instanceof FileHandle ? path : await open((path as fs.PathLike).toString(), options.flag, options.mode);

	const _data = typeof data == 'string' ? data : data;
	if (typeof _data != 'string' && !(_data instanceof Uint8Array)) {
		throw new ErrnoError(Errno.EINVAL, 'Iterables and streams not supported', handle.file.path, 'writeFile');
	}
	await handle.writeFile(_data, options);
}
writeFile satisfies typeof promises.writeFile;

/**
 * Asynchronously append data to a file, creating the file if it not yet exists.
 * @option encoding Defaults to `'utf8'`.
 * @option mode Defaults to `0644`.
 * @option flag Defaults to `'a'`.
 */
export async function appendFile(
	path: fs.PathLike | promises.FileHandle,
	data: FileContents,
	_options?: BufferEncoding | (fs.EncodingOption & { mode?: fs.Mode; flag?: fs.OpenMode }) | null
): Promise<void> {
	const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
	const flag = parseFlag(options.flag);
	if (!isAppendable(flag)) {
		throw new ErrnoError(Errno.EINVAL, 'Flag passed to appendFile must allow for appending.');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ErrnoError(Errno.EINVAL, 'Encoding not specified');
	}
	const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	await using handle: FileHandle | promises.FileHandle = typeof path == 'object' && 'fd' in path ? path : await open(path as string, options.flag, options.mode);

	await handle.appendFile(encodedData, options);
}
appendFile satisfies typeof promises.appendFile;

// DIRECTORY-ONLY METHODS

export async function rmdir(path: fs.PathLike): Promise<void> {
	path = normalizePath(path);
	path = (await exists(path)) ? await realpath(path) : path;
	const { fs, path: resolved } = resolveMount(path);
	try {
		if (!(await fs.stat(resolved)).hasAccess(constants.W_OK)) {
			throw ErrnoError.With('EACCES', resolved, 'rmdir');
		}
		await fs.rmdir(resolved);
		emitChange('rename', path.toString());
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
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
	options = typeof options === 'object' ? options : { mode: options };
	const mode = normalizeMode(options?.mode, 0o777);

	path = normalizePath(path);
	path = (await exists(path)) ? await realpath(path) : path;
	const { fs, path: resolved } = resolveMount(path);
	const errorPaths: Record<string, string> = { [resolved]: path };

	try {
		if (!options?.recursive) {
			if (!(await fs.stat(dirname(resolved))).hasAccess(constants.W_OK)) {
				throw ErrnoError.With('EACCES', dirname(resolved), 'mkdir');
			}
			await fs.mkdir(resolved, mode);
			emitChange('rename', path.toString());
			return;
		}

		const dirs: string[] = [];
		for (let dir = resolved, origDir = path; !(await fs.exists(dir)); dir = dirname(dir), origDir = dirname(origDir)) {
			dirs.unshift(dir);
			errorPaths[dir] = origDir;
		}
		for (const dir of dirs) {
			if (!(await fs.stat(dirname(dir))).hasAccess(constants.W_OK)) {
				throw ErrnoError.With('EACCES', dirname(dir), 'mkdir');
			}
			await fs.mkdir(dir, mode);
			emitChange('rename', dir);
		}
		return dirs[0];
	} catch (e) {
		throw fixError(e as Error, errorPaths);
	}
}
mkdir satisfies typeof promises.mkdir;

/**
 * Asynchronous readdir(3) - read a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'`.
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
	if (!(await stat(path)).hasAccess(constants.R_OK)) {
		throw ErrnoError.With('EACCES', path, 'readdir');
	}
	path = (await exists(path)) ? await realpath(path) : path;
	const { fs, path: resolved } = resolveMount(path);
	let entries: string[];
	try {
		entries = await fs.readdir(resolved);
	} catch (e) {
		throw fixError(e as Error, { [resolved]: path });
	}
	for (const point of mounts.keys()) {
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

export async function link(targetPath: fs.PathLike, linkPath: fs.PathLike): Promise<void> {
	targetPath = normalizePath(targetPath);
	if (!(await stat(dirname(targetPath))).hasAccess(constants.R_OK)) {
		throw ErrnoError.With('EACCES', dirname(targetPath), 'link');
	}
	linkPath = normalizePath(linkPath);
	if (!(await stat(dirname(linkPath))).hasAccess(constants.W_OK)) {
		throw ErrnoError.With('EACCES', dirname(linkPath), 'link');
	}

	const { fs, path } = resolveMount(targetPath);
	const link = resolveMount(linkPath);
	if (fs != link.fs) {
		throw ErrnoError.With('EXDEV', linkPath, 'link');
	}
	try {
		if (!(await fs.stat(path)).hasAccess(constants.W_OK)) {
			throw ErrnoError.With('EACCES', path, 'link');
		}
		return await fs.link(path, link.path);
	} catch (e) {
		throw fixError(e as Error, { [link.path]: linkPath, [path]: targetPath });
	}
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
		throw new ErrnoError(Errno.EINVAL, 'Invalid symlink type: ' + type);
	}

	if (await exists(path)) {
		throw ErrnoError.With('EEXIST', path.toString(), 'symlink');
	}

	await writeFile(path, target.toString());
	const handle = await _open(path, 'r+', 0o644, false);
	await handle.file._setType(constants.S_IFLNK);
}
symlink satisfies typeof promises.symlink;

export async function readlink(path: fs.PathLike, options: fs.BufferEncodingOption): Promise<Buffer>;
export async function readlink(path: fs.PathLike, options?: fs.EncodingOption | null): Promise<string>;
export async function readlink(path: fs.PathLike, options?: fs.BufferEncodingOption | fs.EncodingOption | string | null): Promise<string | Buffer>;
export async function readlink(path: fs.PathLike, options?: fs.BufferEncodingOption | fs.EncodingOption | string | null): Promise<string | Buffer> {
	await using handle = await _open(normalizePath(path), 'r', 0o644, false);
	const value = await handle.readFile();
	const encoding = typeof options == 'object' ? options?.encoding : options;
	return encoding == 'buffer' ? value : value.toString(encoding! as BufferEncoding);
}
readlink satisfies typeof promises.readlink;

// PROPERTY OPERATIONS

export async function chown(path: fs.PathLike, uid: number, gid: number): Promise<void> {
	await using handle = await open(path, 'r+');
	await handle.chown(uid, gid);
}
chown satisfies typeof promises.chown;

export async function lchown(path: fs.PathLike, uid: number, gid: number): Promise<void> {
	await using handle: FileHandle = await _open(path, 'r+', 0o644, false);
	await handle.chown(uid, gid);
}
lchown satisfies typeof promises.lchown;

export async function chmod(path: fs.PathLike, mode: fs.Mode): Promise<void> {
	await using handle = await open(path, 'r+');
	await handle.chmod(mode);
}
chmod satisfies typeof promises.chmod;

export async function lchmod(path: fs.PathLike, mode: fs.Mode): Promise<void> {
	await using handle: FileHandle = await _open(path, 'r+', 0o644, false);
	await handle.chmod(mode);
}
lchmod satisfies typeof promises.lchmod;

/**
 * Change file timestamps of the file referenced by the supplied path.
 */
export async function utimes(path: fs.PathLike, atime: string | number | Date, mtime: string | number | Date): Promise<void> {
	await using handle = await open(path, 'r+');
	await handle.utimes(atime, mtime);
}
utimes satisfies typeof promises.utimes;

/**
 * Change file timestamps of the file referenced by the supplied path.
 */
export async function lutimes(path: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike): Promise<void> {
	await using handle: FileHandle = await _open(path, 'r+', 0o644, false);
	await handle.utimes(new Date(atime), new Date(mtime));
}
lutimes satisfies typeof promises.lutimes;

/**
 * Asynchronous realpath(3) - return the canonicalized absolute pathname.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. Defaults to `'utf8'`.
 */
export async function realpath(path: fs.PathLike, options: fs.BufferEncodingOption): Promise<Buffer>;
export async function realpath(path: fs.PathLike, options?: fs.EncodingOption | BufferEncoding): Promise<string>;
export async function realpath(path: fs.PathLike, options?: fs.EncodingOption | BufferEncoding | fs.BufferEncodingOption): Promise<string | Buffer> {
	path = normalizePath(path);
	const { base, dir } = parse(path);
	const lpath = join(dir == '/' ? '/' : await realpath(dir), base);
	const { fs, path: resolvedPath, mountPoint } = resolveMount(lpath);

	try {
		const stats = await fs.stat(resolvedPath);
		if (!stats.isSymbolicLink()) {
			return lpath;
		}

		return realpath(mountPoint + (await readlink(lpath)));
	} catch (e) {
		throw fixError(e as Error, { [resolvedPath]: lpath });
	}
}
realpath satisfies typeof promises.realpath;

export function watch(filename: fs.PathLike, options?: fs.WatchOptions | BufferEncoding): AsyncIterable<FileChangeInfo<string>>;
export function watch(filename: fs.PathLike, options: fs.WatchOptions | fs.BufferEncodingOption): AsyncIterable<FileChangeInfo<Buffer>>;
export function watch(filename: fs.PathLike, options?: fs.WatchOptions | string): AsyncIterable<FileChangeInfo<string>> | AsyncIterable<FileChangeInfo<Buffer>>;
export function watch<T extends string | Buffer>(filename: fs.PathLike, options: fs.WatchOptions | string = {}): AsyncIterable<FileChangeInfo<T>> {
	return {
		[Symbol.asyncIterator](): AsyncIterator<FileChangeInfo<T>> {
			const watcher = new FSWatcher<T>(filename.toString(), typeof options != 'string' ? options : { encoding: options as BufferEncoding | 'buffer' });

			function withDone(done: boolean) {
				return function () {
					const event = Promise.withResolvers<IteratorResult<FileChangeInfo<T>>>();
					watcher.on('change', (eventType, filename) => {
						event.resolve({ value: { eventType, filename }, done });
					});
					return event.promise;
				};
			}

			return {
				next: withDone(false),
				return: withDone(true),
				throw: withDone(true),
			};
		},
	};
}
watch satisfies typeof promises.watch;

export async function access(path: fs.PathLike, mode: number = constants.F_OK): Promise<void> {
	const stats = await stat(path);
	if (!stats.hasAccess(mode)) {
		throw new ErrnoError(Errno.EACCES);
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
					await rm(join(path, entry), options);
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
			throw new ErrnoError(Errno.EPERM, 'File type not supported', path, 'rm');
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
		throw new ErrnoError(Errno.EEXIST, 'Destination file already exists.', dest, 'copyFile');
	}

	await writeFile(dest, await readFile(src));
	emitChange('rename', dest.toString());
}
copyFile satisfies typeof promises.copyFile;

/**
 * Asynchronous `opendir`. Opens a directory.
 * @param path The path to the directory.
 * @param options Options for opening the directory.
 * @returns A `Dir` object representing the opened directory.
 * @todo Use options
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
 *   * `filter`: A function that takes a source and destination path and returns a boolean, indicating whether to copy `source` element.
 *   * `force`: Overwrite the destination if it exists, and overwrite existing readonly destination files.
 *   * `preserveTimestamps`: Preserve file timestamps.
 *   * `recursive`: If `true`, copies directories recursively.
 */
export async function cp(source: fs.PathLike, destination: fs.PathLike, opts?: fs.CopyOptions): Promise<void> {
	source = normalizePath(source);
	destination = normalizePath(destination);

	const srcStats = await lstat(source); // Use lstat to follow symlinks if not dereferencing

	if (opts?.errorOnExist && (await exists(destination))) {
		throw new ErrnoError(Errno.EEXIST, 'Destination file or directory already exists.', destination, 'cp');
	}

	switch (srcStats.mode & constants.S_IFMT) {
		case constants.S_IFDIR:
			if (!opts?.recursive) {
				throw new ErrnoError(Errno.EISDIR, source + ' is a directory (not copied)', source, 'cp');
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
			throw new ErrnoError(Errno.EPERM, 'File type not supported', source, 'rm');
	}

	// Optionally preserve timestamps
	if (opts?.preserveTimestamps) {
		await utimes(destination, srcStats.atime, srcStats.mtime);
	}
}
cp satisfies typeof promises.cp;

/**
 * @since Node v18.15.0
 * @returns Fulfills with an {fs.StatFs} for the file system.
 */
export async function statfs(path: fs.PathLike, opts?: fs.StatFsOptions & { bigint?: false }): Promise<fs.StatsFs>;
export async function statfs(path: fs.PathLike, opts: fs.StatFsOptions & { bigint: true }): Promise<fs.BigIntStatsFs>;
export async function statfs(path: fs.PathLike, opts?: fs.StatFsOptions): Promise<fs.StatsFs | fs.BigIntStatsFs>;
export async function statfs(path: fs.PathLike, opts?: fs.StatFsOptions): Promise<fs.StatsFs | fs.BigIntStatsFs> {
	path = normalizePath(path);
	const { fs } = resolveMount(path);
	return _statfs(fs, opts?.bigint);
}
