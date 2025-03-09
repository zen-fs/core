/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import type * as fs from 'node:fs';
import type * as promises from 'node:fs/promises';
import type { Stream } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { V_Context } from '../context.js';
import type { InodeLike } from '../internal/inode.js';
import type { Interface as ReadlineInterface } from '../readline.js';
import type { ResolvedPath } from './shared.js';
import type { FileContents, GlobOptionsU, NullEnc, OpenOptions, ReaddirOptions, ReaddirOptsI, ReaddirOptsU } from './types.js';

import { Buffer } from 'buffer';
import { _throw, pick } from 'utilium';
import { credentials } from '../internal/credentials.js';
import { Errno, ErrnoError } from '../internal/error.js';
import type { FileSystem, StreamOptions } from '../internal/filesystem.js';
import { InodeFlags, isBlockDevice, isCharacterDevice } from '../internal/inode.js';
import { dirname, join, parse, resolve } from '../path.js';
import '../polyfills.js';
import { createInterface } from '../readline.js';
import { decodeUTF8, normalizeMode, normalizeOptions, normalizePath, normalizeTime } from '../utils.js';
import { config } from './config.js';
import * as constants from './constants.js';
import { Dir, Dirent } from './dir.js';
import * as file from './file.js';
import { _statfs, fixError, resolveMount } from './shared.js';
import { _chown, BigIntStats, Stats } from './stats.js';
import { ReadStream, WriteStream } from './streams.js';
import { emitChange, FSWatcher } from './watchers.js';
export * as constants from './constants.js';

export class FileHandle implements promises.FileHandle {
	protected _buffer?: Uint8Array;

	/**
	 * Current position
	 */
	protected _position: number = 0;

	/**
	 * Get the current file position.
	 *
	 * We emulate the following bug mentioned in the Node documentation:
	 *
	 * On Linux, positional writes don't work when the file is opened in append mode.
	 * The kernel ignores the position argument and always appends the data to the end of the file.
	 * @returns The current file position.
	 */
	public get position(): number {
		return file.isAppendable(this.flag) ? this.stats.size : this._position;
	}

	public set position(value: number) {
		this._position = value;
	}

	/**
	 * Whether the file has changes which have not been written to the FS
	 */
	protected dirty: boolean = false;

	/**
	 * Whether the file is open or closed
	 */
	protected closed: boolean = false;

	/** The path relative to the context's root */
	public readonly path!: string;

	/** The internal FS associated with the handle */
	protected readonly fs!: FileSystem;

	/** The path relative to the `FileSystem`'s root */
	public readonly internalPath!: string;

	/** The flag the handle was opened with */
	public readonly flag!: string;

	/** Stats for the handle */
	public readonly stats!: InodeLike;

	public constructor(
		protected context: V_Context,
		public readonly fd: number
	) {
		const sync = file.fromFD(context, fd);
		Object.assign(this, pick(sync, 'path', 'fs', 'internalPath', 'flag', 'stats'));
	}

	private _emitChange() {
		emitChange(this.context, 'change', this.path);
	}

	/**
	 * Asynchronous fchown(2) - Change ownership of a file.
	 */
	public async chown(uid: number, gid: number): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chown');
		this.dirty = true;
		_chown(this.stats, uid, gid);
		if (config.syncImmediately) await this.sync();
		this._emitChange();
	}

	/**
	 * Asynchronous fchmod(2) - Change permissions of a file.
	 * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
	 */
	public async chmod(mode: fs.Mode): Promise<void> {
		const numMode = normalizeMode(mode, -1);
		if (numMode < 0) throw new ErrnoError(Errno.EINVAL, 'Invalid mode');
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chmod');
		this.dirty = true;
		this.stats.mode = (this.stats.mode & (numMode > constants.S_IFMT ? ~constants.S_IFMT : constants.S_IFMT)) | numMode;
		if (config.syncImmediately || numMode > constants.S_IFMT) await this.sync();
		this._emitChange();
	}

	/**
	 * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
	 */
	public datasync(): Promise<void> {
		return this.sync();
	}

	/**
	 * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
	 */
	public async sync(): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'sync');

		if (!this.dirty) return;

		if (!this.fs.attributes.has('no_write')) await this.fs.touch(this.internalPath, this.stats);
		this.dirty = false;
	}

	/**
	 * Asynchronous ftruncate(2) - Truncate a file to a specified length.
	 * @param length If not specified, defaults to `0`.
	 */
	public async truncate(length: number = 0): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'truncate');

		if (length < 0) throw new ErrnoError(Errno.EINVAL);

		this.dirty = true;
		if (!file.isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode');
		}
		this.stats.mtimeMs = Date.now();
		this.stats.size = length;
		if (config.syncImmediately) await this.sync();
		this._emitChange();
	}

	/**
	 * Asynchronously change file timestamps of the file.
	 * @param atime The last access time. If a string is provided, it will be coerced to number.
	 * @param mtime The last modified time. If a string is provided, it will be coerced to number.
	 */
	public async utimes(atime: string | number | Date, mtime: string | number | Date): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'utimes');

		this.dirty = true;
		this.stats.atimeMs = normalizeTime(atime);
		this.stats.mtimeMs = normalizeTime(mtime);
		if (config.syncImmediately) await this.sync();

		this._emitChange();
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
	public async appendFile(
		data: string | Uint8Array,
		_options: (fs.ObjectEncodingOptions & promises.FlagAndOpenMode) | BufferEncoding = {}
	): Promise<void> {
		const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
		const flag = file.parseFlag(options.flag);
		if (!file.isAppendable(flag)) {
			throw new ErrnoError(Errno.EINVAL, 'Flag passed to appendFile must allow for appending');
		}
		if (typeof data != 'string' && !options.encoding) {
			throw new ErrnoError(Errno.EINVAL, 'Encoding not specified');
		}
		const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : data;
		await this._write(encodedData, 0, encodedData.length);
		this._emitChange();
	}

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from in the file.
	 * If position is unset, data will be read from the current file position.
	 */
	protected async _read<TBuffer extends ArrayBufferView>(
		buffer: TBuffer,
		offset: number = 0,
		length: number = buffer.byteLength - offset,
		position: number = this.position
	): Promise<{ bytesRead: number; buffer: TBuffer }> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'read');

		if (!file.isReadable(this.flag)) throw new ErrnoError(Errno.EPERM, 'File not opened with a readable mode');

		if (config.updateOnRead) this.dirty = true;

		this.stats.atimeMs = Date.now();

		let end = position + length;
		if (!isCharacterDevice(this.stats) && !isBlockDevice(this.stats) && end > this.stats.size) {
			end = position + Math.max(this.stats.size - position, 0);
		}
		this._position = end;
		const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		await this.fs.read(this.internalPath, uint8.subarray(offset, offset + length), position, end);
		if (config.syncImmediately) await this.sync();
		return { bytesRead: end - position, buffer };
	}

	/**
	 * Asynchronously reads data from the file.
	 * The `FileHandle` must have been opened for reading.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset in the buffer at which to start writing.
	 * @param length The number of bytes to read.
	 * @param position The offset from the beginning of the file from which data should be read. If `null`, data will be read from the current position.
	 */
	public async read<T extends NodeJS.ArrayBufferView>(
		buffer: T,
		offset?: number,
		length?: number,
		position?: number | null
	): Promise<promises.FileReadResult<T>>;
	public async read<T extends NodeJS.ArrayBufferView = Buffer>(
		buffer: T,
		options?: promises.FileReadOptions<T>
	): Promise<promises.FileReadResult<T>>;
	public async read<T extends NodeJS.ArrayBufferView = Buffer>(options?: promises.FileReadOptions<T>): Promise<promises.FileReadResult<T>>;
	public async read<T extends NodeJS.ArrayBufferView = Buffer>(
		buffer?: T | promises.FileReadOptions<T>,
		offset?: number | null | promises.FileReadOptions<T>,
		length?: number | null,
		position?: number | null
	) {
		if (typeof offset == 'object' && offset != null) {
			position = offset.position;
			length = offset.length;
			offset = offset.offset;
		}

		if (!ArrayBuffer.isView(buffer) && typeof buffer == 'object') {
			position = buffer.position;
			length = buffer.length;
			offset = buffer.offset;
			buffer = buffer.buffer;
		}

		const pos = Number.isSafeInteger(position) ? position! : this.position;
		buffer ||= new Uint8Array(this.stats.size) as T;
		offset ??= 0;
		return this._read(buffer, offset, length ?? buffer.byteLength - offset, pos);
	}

	/**
	 * Asynchronously reads the entire contents of a file. The underlying file will _not_ be closed automatically.
	 * The `FileHandle` must have been opened for reading.
	 * @param _options An object that may contain an optional flag.
	 * If a flag is not provided, it defaults to `'r'`.
	 */
	public async readFile(_options?: { flag?: fs.OpenMode }): Promise<Buffer>;
	public async readFile(_options: (fs.ObjectEncodingOptions & promises.FlagAndOpenMode) | BufferEncoding): Promise<string>;
	public async readFile(_options?: (fs.ObjectEncodingOptions & promises.FlagAndOpenMode) | BufferEncoding): Promise<string | Buffer> {
		const options = normalizeOptions(_options, null, 'r', 0o444);
		const flag = file.parseFlag(options.flag);
		if (!file.isReadable(flag)) {
			throw new ErrnoError(Errno.EINVAL, 'Flag passed must allow for reading');
		}

		const { size } = await this.stat();
		const { buffer: data } = await this._read(new Uint8Array(size), 0, size, 0);
		const buffer = Buffer.from(data);
		return options.encoding ? buffer.toString(options.encoding) : buffer;
	}

	/**
	 * Read file data using a `ReadableStream`.
	 * The handle will not be closed automatically.
	 */
	public readableWebStream(options: promises.ReadableWebStreamOptions & StreamOptions = {}): NodeReadableStream<Uint8Array> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'readableWebStream');
		return this.fs.streamRead(this.internalPath, options);
	}

	/**
	 * Not part of the Node.js API!
	 *
	 * Write file data using a `WritableStream`.
	 * The handle will not be closed automatically.
	 * @internal
	 */
	public writableWebStream(options: promises.ReadableWebStreamOptions & StreamOptions = {}): WritableStream {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'writableWebStream');
		if (this.stats.flags! & InodeFlags.Immutable) throw new ErrnoError(Errno.EPERM, 'File is immutable', this.path, 'writableWebStream');
		return this.fs.streamWrite(this.internalPath, options);
	}

	/**
	 * Creates a readline Interface object that allows reading the file line by line
	 * @param options Options for creating a read stream
	 * @returns A readline interface for reading the file line by line
	 */
	public readLines(options?: promises.CreateReadStreamOptions): ReadlineInterface {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'readLines');

		if (!file.isReadable(this.flag)) {
			throw ErrnoError.With('EBADF', this.path, 'readLines');
		}

		return createInterface({ input: this.createReadStream(options), crlfDelay: Infinity });
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
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'stat');

		const stats = new Stats(this.stats);
		if (config.checkAccess && !stats.hasAccess(constants.R_OK, this.context)) {
			throw ErrnoError.With('EACCES', this.path, 'stat');
		}
		return opts?.bigint ? new BigIntStats(stats) : stats;
	}

	/**
	 * Write buffer to the file.
	 * @param buffer Uint8Array containing the data to write to the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this data should be written.
	 * If position is null, the data will be written at  the current position.
	 */
	protected async _write(
		buffer: Uint8Array,
		offset: number = 0,
		length: number = buffer.byteLength - offset,
		position: number = this.position
	): Promise<number> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'write');

		if (this.stats.flags! & InodeFlags.Immutable) throw new ErrnoError(Errno.EPERM, 'File is immutable', this.path, 'write');

		if (!file.isWriteable(this.flag)) throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode');

		this.dirty = true;
		const end = position + length;
		const slice = buffer.subarray(offset, offset + length);

		if (!isCharacterDevice(this.stats) && !isBlockDevice(this.stats) && end > this.stats.size) this.stats.size = end;

		this.stats.mtimeMs = Date.now();
		this.stats.ctimeMs = Date.now();

		this._position = position + slice.byteLength;
		await this.fs.write(this.internalPath, slice, position);
		if (config.syncImmediately) await this.sync();
		return slice.byteLength;
	}

	/**
	 * Asynchronously writes `string` to the file.
	 * The `FileHandle` must have been opened for writing.
	 * It is unsafe to call `write()` multiple times on the same file without waiting for the `Promise`
	 * to be resolved (or rejected). For this scenario, `createWriteStream` is strongly recommended.
	 */
	public async write<T extends FileContents>(
		data: T,
		options?: number | null | { offset?: number; length?: number; position?: number },
		lenOrEnc?: BufferEncoding | number | null,
		position?: number | null
	): Promise<{ bytesWritten: number; buffer: T }> {
		let buffer: Uint8Array, offset: number | null | undefined, length: number;
		if (typeof options == 'object' && options != null) {
			lenOrEnc = options.length;
			position = options.position;
			options = options.offset;
		}
		if (typeof data === 'string') {
			position = typeof options === 'number' ? options : null;
			offset = 0;
			buffer = Buffer.from(data, typeof lenOrEnc === 'string' ? lenOrEnc : 'utf8');
			length = buffer.length;
		} else {
			buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			offset = options ?? 0;
			length = typeof lenOrEnc == 'number' ? lenOrEnc : buffer.byteLength;
			position = typeof position === 'number' ? position : null;
		}
		position ??= this.position;
		const bytesWritten = await this._write(buffer, offset, length, position);
		this._emitChange();
		return { buffer: data, bytesWritten };
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
		const flag = file.parseFlag(options.flag);
		if (!file.isWriteable(flag)) {
			throw new ErrnoError(Errno.EINVAL, 'Flag passed must allow for writing');
		}
		if (typeof data != 'string' && !options.encoding) {
			throw new ErrnoError(Errno.EINVAL, 'Encoding not specified');
		}
		const encodedData = typeof data == 'string' ? Buffer.from(data, options.encoding!) : data;
		await this._write(encodedData, 0, encodedData.length, 0);
		this._emitChange();
	}

	/**
	 * Asynchronous close(2) - close a `FileHandle`.
	 */
	public async close(): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'close');
		await this.sync();
		this.dispose();
		file.deleteFD(this.context, this.fd);
	}

	/**
	 * Cleans up. This will *not* sync the file data to the FS
	 */
	protected dispose(force?: boolean): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'dispose');

		if (this.dirty && !force) throw ErrnoError.With('EBUSY', this.path, 'dispose');

		this.closed = true;
	}

	/**
	 * Asynchronous `writev`. Writes from multiple buffers.
	 * @param buffers An array of Uint8Array buffers.
	 * @param position The position in the file where to begin writing.
	 * @returns The number of bytes written.
	 */
	public async writev(buffers: Uint8Array[], position?: number): Promise<fs.WriteVResult> {
		if (typeof position == 'number') this.position = position;

		let bytesWritten = 0;

		for (const buffer of buffers) {
			bytesWritten += (await this.write(buffer)).bytesWritten;
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
		if (typeof position == 'number') this.position = position;

		let bytesRead = 0;

		for (const buffer of buffers) {
			bytesRead += (await this.read(buffer)).bytesRead;
		}

		return { bytesRead, buffers };
	}

	/**
	 * Creates a stream for reading from the file.
	 * @param options Options for the readable stream
	 */
	public createReadStream(options: promises.CreateReadStreamOptions = {}): ReadStream {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'createReadStream');
		return new ReadStream(options, this);
	}

	/**
	 * Creates a stream for writing to the file.
	 * @param options Options for the writeable stream.
	 */
	public createWriteStream(options: promises.CreateWriteStreamOptions = {}): WriteStream {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'createWriteStream');
		if (this.stats.flags! & InodeFlags.Immutable) throw new ErrnoError(Errno.EPERM, 'File is immutable', this.path, 'createWriteStream');
		return new WriteStream(options, this);
	}
}

export async function rename(this: V_Context, oldPath: fs.PathLike, newPath: fs.PathLike): Promise<void> {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const src = resolveMount(oldPath, this);
	const dst = resolveMount(newPath, this);
	if (config.checkAccess && !(await stat.call(this, dirname(oldPath))).hasAccess(constants.W_OK, this)) {
		throw ErrnoError.With('EACCES', oldPath, 'rename');
	}
	try {
		if (src.mountPoint == dst.mountPoint) {
			await src.fs.rename(src.path, dst.path);
			emitChange(this, 'rename', oldPath.toString());
			emitChange(this, 'change', newPath.toString());
			return;
		}
		await writeFile.call(this, newPath, await readFile(oldPath));
		await unlink.call(this, oldPath);
		emitChange(this, 'rename', oldPath.toString());
	} catch (e) {
		throw fixError(e as ErrnoError, { [src.path]: oldPath, [dst.path]: newPath });
	}
}
rename satisfies typeof promises.rename;

/**
 * Test whether or not `path` exists by checking with the file system.
 */
export async function exists(this: V_Context, path: fs.PathLike): Promise<boolean> {
	try {
		const { fs, path: resolved } = resolveMount(await realpath.call(this, path), this);
		return await fs.exists(resolved);
	} catch (e) {
		if (e instanceof ErrnoError && e.code == 'ENOENT') {
			return false;
		}

		throw e;
	}
}

export async function stat(this: V_Context, path: fs.PathLike, options: fs.BigIntOptions): Promise<BigIntStats>;
export async function stat(this: V_Context, path: fs.PathLike, options?: { bigint?: false }): Promise<Stats>;
export async function stat(this: V_Context, path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats>;
export async function stat(this: V_Context, path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(await realpath.call(this, path), this);
	try {
		const stats = new Stats(await fs.stat(resolved));
		if (config.checkAccess && !stats.hasAccess(constants.R_OK, this)) {
			throw ErrnoError.With('EACCES', resolved, 'stat');
		}
		return options?.bigint ? new BigIntStats(stats) : stats;
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}
stat satisfies typeof promises.stat;

/**
 * `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 */
export async function lstat(this: V_Context, path: fs.PathLike, options?: { bigint?: boolean }): Promise<Stats>;
export async function lstat(this: V_Context, path: fs.PathLike, options: { bigint: true }): Promise<BigIntStats>;
export async function lstat(this: V_Context, path: fs.PathLike, options?: fs.StatOptions): Promise<Stats | BigIntStats> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);
	try {
		const stats = new Stats(await fs.stat(resolved));
		return options?.bigint ? new BigIntStats(stats) : stats;
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}
lstat satisfies typeof promises.lstat;

// FILE-ONLY METHODS

export async function truncate(this: V_Context, path: fs.PathLike, len: number = 0): Promise<void> {
	await using handle = await open.call(this, path, 'r+');
	await handle.truncate(len);
}
truncate satisfies typeof promises.truncate;

export async function unlink(this: V_Context, path: fs.PathLike): Promise<void> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);
	try {
		if (config.checkAccess && !new Stats(await fs.stat(resolved)).hasAccess(constants.W_OK, this)) {
			throw ErrnoError.With('EACCES', resolved, 'unlink');
		}
		await fs.unlink(resolved);
		emitChange(this, 'rename', path.toString());
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}
unlink satisfies typeof promises.unlink;

/**
 * Opens a file. This helper handles the complexity of file flags.
 * @internal
 */
async function _open($: V_Context, path: fs.PathLike, opt: OpenOptions): Promise<FileHandle> {
	path = normalizePath(path);
	const mode = normalizeMode(opt.mode, 0o644),
		flag = file.parseFlag(opt.flag);

	const { fullPath, fs, path: resolved, stats } = await _resolve($, path.toString(), opt.preserveSymlinks);

	if (!stats) {
		if ((!file.isWriteable(flag) && !file.isAppendable(flag)) || flag == 'r+') {
			throw ErrnoError.With('ENOENT', fullPath, '_open');
		}
		// Create the file
		const parentStats: Stats = new Stats(await fs.stat(dirname(resolved)));
		if (config.checkAccess && !parentStats.hasAccess(constants.W_OK, $)) {
			throw ErrnoError.With('EACCES', dirname(fullPath), '_open');
		}
		if (!parentStats.isDirectory()) {
			throw ErrnoError.With('ENOTDIR', dirname(fullPath), '_open');
		}
		const { euid: uid, egid: gid } = $?.credentials ?? credentials;

		const inode = await fs.createFile(resolved, {
			mode,
			uid: parentStats.mode & constants.S_ISUID ? parentStats.uid : uid,
			gid: parentStats.mode & constants.S_ISGID ? parentStats.gid : gid,
		});

		return new FileHandle($, file.toFD(new file.SyncHandle($, path, fs, resolved, flag, inode)));
	}

	if (config.checkAccess && !stats.hasAccess(file.flagToMode(flag), $)) {
		throw ErrnoError.With('EACCES', fullPath, '_open');
	}

	if (file.isExclusive(flag)) {
		throw ErrnoError.With('EEXIST', fullPath, '_open');
	}

	const handle = new FileHandle($, file.toFD(new file.SyncHandle($, path, fs, resolved, flag, stats)));

	/*
		In a previous implementation, we deleted the file and
		re-created it. However, this created a race condition if another
		asynchronous request was trying to read the file, as the file
		would not exist for a small period of time.
	*/
	if (file.isTruncating(flag)) {
		await handle.truncate(0);
	}

	return handle;
}

/**
 * Asynchronous file open.
 * @see http://www.manpagez.com/man/2/open/
 * @param flag Handles the complexity of the various file modes. See its API for more details.
 * @param mode Mode to use to open the file. Can be ignored if the filesystem doesn't support permissions.
 */
export async function open(this: V_Context, path: fs.PathLike, flag: fs.OpenMode = 'r', mode: fs.Mode = 0o644): Promise<FileHandle> {
	return await _open(this, path, { flag, mode });
}
open satisfies typeof promises.open;

/**
 * Asynchronously reads the entire contents of a file.
 * @option encoding The string encoding for the file contents. Defaults to `null`.
 * @option flag Defaults to `'r'`.
 * @returns the file data
 */
export async function readFile(
	this: V_Context,
	path: fs.PathLike | promises.FileHandle,
	options?: { encoding?: null; flag?: fs.OpenMode } | null
): Promise<Buffer>;
export async function readFile(
	this: V_Context,
	path: fs.PathLike | promises.FileHandle,
	options: { encoding: BufferEncoding; flag?: fs.OpenMode } | BufferEncoding
): Promise<string>;
export async function readFile(
	this: V_Context,
	path: fs.PathLike | promises.FileHandle,
	options?: (fs.ObjectEncodingOptions & { flag?: fs.OpenMode }) | BufferEncoding | null
): Promise<string | Buffer>;
export async function readFile(
	this: V_Context,
	path: fs.PathLike | promises.FileHandle,
	_options?: (fs.ObjectEncodingOptions & { flag?: fs.OpenMode }) | BufferEncoding | null
): Promise<Buffer | string> {
	const options = normalizeOptions(_options, null, 'r', 0o444);
	await using handle: FileHandle =
		typeof path == 'object' && 'fd' in path ? (path as FileHandle) : await open.call(this, path, options.flag, options.mode);
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
	this: V_Context,
	path: fs.PathLike | promises.FileHandle,
	data: FileContents | Stream | Iterable<string | ArrayBufferView> | AsyncIterable<string | ArrayBufferView>,
	_options?: (fs.ObjectEncodingOptions & { mode?: fs.Mode; flag?: fs.OpenMode; flush?: boolean }) | BufferEncoding | null
): Promise<void> {
	const options = normalizeOptions(_options, 'utf8', 'w+', 0o644);
	await using handle = path instanceof FileHandle ? path : await open.call(this, (path as fs.PathLike).toString(), options.flag, options.mode);

	const _data = typeof data == 'string' ? data : data instanceof DataView ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data;
	if (typeof _data != 'string' && !(_data instanceof Uint8Array)) {
		throw new ErrnoError(
			Errno.EINVAL,
			'The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ' + typeof data,
			handle.path,
			'writeFile'
		);
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
	this: V_Context,
	path: fs.PathLike | promises.FileHandle,
	data: FileContents,
	_options?: BufferEncoding | (fs.EncodingOption & { mode?: fs.Mode; flag?: fs.OpenMode }) | null
): Promise<void> {
	const options = normalizeOptions(_options, 'utf8', 'a', 0o644);
	const flag = file.parseFlag(options.flag);
	if (!file.isAppendable(flag)) {
		throw new ErrnoError(Errno.EINVAL, 'Flag passed to appendFile must allow for appending');
	}
	if (typeof data != 'string' && !options.encoding) {
		throw new ErrnoError(Errno.EINVAL, 'Encoding not specified');
	}
	const encodedData =
		typeof data == 'string' ? Buffer.from(data, options.encoding!) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	await using handle: FileHandle | promises.FileHandle =
		typeof path == 'object' && 'fd' in path ? path : await open.call(this, path as string, options.flag, options.mode);

	await handle.appendFile(encodedData, options);
}
appendFile satisfies typeof promises.appendFile;

// DIRECTORY-ONLY METHODS

export async function rmdir(this: V_Context, path: fs.PathLike): Promise<void> {
	path = await realpath.call(this, path);
	const { fs, path: resolved } = resolveMount(path, this);
	try {
		const stats = new Stats(await fs.stat(resolved));
		if (!stats) {
			throw ErrnoError.With('ENOENT', path, 'rmdir');
		}
		if (!stats.isDirectory()) {
			throw ErrnoError.With('ENOTDIR', resolved, 'rmdir');
		}
		if (config.checkAccess && !stats.hasAccess(constants.W_OK, this)) {
			throw ErrnoError.With('EACCES', resolved, 'rmdir');
		}
		await fs.rmdir(resolved);
		emitChange(this, 'rename', path.toString());
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}
rmdir satisfies typeof promises.rmdir;

/**
 * Asynchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
export async function mkdir(this: V_Context, path: fs.PathLike, options: fs.MakeDirectoryOptions & { recursive: true }): Promise<string | undefined>;
export async function mkdir(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.Mode | (fs.MakeDirectoryOptions & { recursive?: false | undefined }) | null
): Promise<void>;
export async function mkdir(this: V_Context, path: fs.PathLike, options?: fs.Mode | fs.MakeDirectoryOptions | null): Promise<string | undefined>;
export async function mkdir(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.Mode | fs.MakeDirectoryOptions | null
): Promise<string | undefined | void> {
	const { euid: uid, egid: gid } = this?.credentials ?? credentials;
	options = typeof options === 'object' ? options : { mode: options };
	const mode = normalizeMode(options?.mode, 0o777);

	path = await realpath.call(this, path);
	const { fs, path: resolved, root } = resolveMount(path, this);
	const errorPaths: Record<string, string> = { [resolved]: path };

	const __create = async (path: string, parentStats: Stats) => {
		if (config.checkAccess && !parentStats.hasAccess(constants.W_OK, this)) {
			throw ErrnoError.With('EACCES', dirname(path), 'mkdir');
		}

		const inode = await fs.mkdir(path, {
			mode,
			uid: parentStats.mode & constants.S_ISUID ? parentStats.uid : uid,
			gid: parentStats.mode & constants.S_ISGID ? parentStats.gid : gid,
		});
		emitChange(this, 'rename', path);
		return new Stats(inode);
	};

	try {
		if (!options?.recursive) {
			await __create(resolved, new Stats(await fs.stat(dirname(resolved))));
			return;
		}

		const dirs: string[] = [];
		for (let dir = resolved, origDir = path; !(await fs.exists(dir)); dir = dirname(dir), origDir = dirname(origDir)) {
			dirs.unshift(dir);
			errorPaths[dir] = origDir;
		}

		if (!dirs.length) return;

		const stats: Stats[] = [new Stats(await fs.stat(dirname(dirs[0])))];

		for (const [i, dir] of dirs.entries()) {
			stats.push(await __create(dir, stats[i]));
		}
		return root.length == 1 ? dirs[0] : dirs[0]?.slice(root.length);
	} catch (e) {
		throw fixError(e as ErrnoError, errorPaths);
	}
}
mkdir satisfies typeof promises.mkdir;

/**
 * Asynchronous readdir(3) - read a directory.
 *
 * Note: The order of entries is not guaranteed
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'`.
 */
export async function readdir(this: V_Context, path: fs.PathLike, options?: ReaddirOptsI<{ withFileTypes?: false }> | NullEnc): Promise<string[]>;
export async function readdir(
	this: V_Context,
	path: fs.PathLike,
	options: fs.BufferEncodingOption & ReaddirOptions & { withFileTypes?: false }
): Promise<Buffer[]>;
export async function readdir(
	this: V_Context,
	path: fs.PathLike,
	options?: ReaddirOptsI<{ withFileTypes?: false }> | NullEnc
): Promise<string[] | Buffer[]>;
export async function readdir(this: V_Context, path: fs.PathLike, options: ReaddirOptsI<{ withFileTypes: true }>): Promise<Dirent[]>;
export async function readdir(
	this: V_Context,
	path: fs.PathLike,
	options?: ReaddirOptsU<fs.BufferEncodingOption> | NullEnc
): Promise<string[] | Dirent[] | Buffer[]>;
export async function readdir(
	this: V_Context,
	path: fs.PathLike,
	options?: ReaddirOptsU<fs.BufferEncodingOption> | NullEnc
): Promise<string[] | Dirent[] | Buffer[]> {
	options = typeof options === 'object' ? options : { encoding: options };
	path = await realpath.call(this, path);

	const { fs, path: resolved } = resolveMount(path, this);

	const stats = await fs
		.stat(resolved)
		.then(i => new Stats(i))
		.catch((e: ErrnoError) => _throw(fixError(e, { [resolved]: path })));

	if (!stats) {
		throw ErrnoError.With('ENOENT', path, 'readdir');
	}

	if (config.checkAccess && !stats.hasAccess(constants.R_OK, this)) {
		throw ErrnoError.With('EACCES', path, 'readdir');
	}

	if (!stats.isDirectory()) {
		throw ErrnoError.With('ENOTDIR', path, 'readdir');
	}

	const entries = await fs.readdir(resolved).catch((e: ErrnoError) => _throw(fixError(e, { [resolved]: path })));

	const values: (string | Dirent | Buffer)[] = [];
	const addEntry = async (entry: string) => {
		let entryStats: Stats | undefined;
		if (options?.recursive || options?.withFileTypes) {
			entryStats = await fs
				.stat(join(resolved, entry))
				.then(i => new Stats(i))
				.catch((e: ErrnoError): undefined => {
					if (e.code == 'ENOENT') return;
					throw fixError(e, { [resolved]: path });
				});
			if (!entryStats) return;
		}
		if (options?.withFileTypes) {
			values.push(new Dirent(entry, entryStats!));
		} else if (options?.encoding == 'buffer') {
			values.push(Buffer.from(entry));
		} else {
			values.push(entry);
		}

		if (!options?.recursive || !entryStats?.isDirectory()) return;

		for (const subEntry of await readdir.call(this, join(path, entry), options)) {
			if (subEntry instanceof Dirent) {
				subEntry.path = join(entry, subEntry.path);
				values.push(subEntry);
			} else if (Buffer.isBuffer(subEntry)) {
				// Convert Buffer to string, prefix with the full path
				values.push(Buffer.from(join(entry, decodeUTF8(subEntry))));
			} else {
				values.push(join(entry, subEntry));
			}
		}
	};
	await Promise.all(entries.map(addEntry));

	return values as string[] | Dirent[];
}
readdir satisfies typeof promises.readdir;

export async function link(this: V_Context, targetPath: fs.PathLike, linkPath: fs.PathLike): Promise<void> {
	targetPath = normalizePath(targetPath);
	linkPath = normalizePath(linkPath);

	const { fs, path } = resolveMount(targetPath, this);
	const link = resolveMount(linkPath, this);

	if (fs != link.fs) {
		throw ErrnoError.With('EXDEV', linkPath, 'link');
	}

	try {
		if (config.checkAccess && !new Stats(await fs.stat(dirname(targetPath))).hasAccess(constants.R_OK, this)) {
			throw ErrnoError.With('EACCES', dirname(path), 'link');
		}

		if (config.checkAccess && !(await stat.call(this, dirname(linkPath))).hasAccess(constants.W_OK, this)) {
			throw ErrnoError.With('EACCES', dirname(linkPath), 'link');
		}

		if (config.checkAccess && !new Stats(await fs.stat(path)).hasAccess(constants.R_OK, this)) {
			throw ErrnoError.With('EACCES', path, 'link');
		}
		return await fs.link(path, link.path);
	} catch (e) {
		throw fixError(e as ErrnoError, { [link.path]: linkPath, [path]: targetPath });
	}
}
link satisfies typeof promises.link;

/**
 * `symlink`.
 * @param target target path
 * @param path link path
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 */
export async function symlink(
	this: V_Context,
	target: fs.PathLike,
	path: fs.PathLike,
	type: fs.symlink.Type | string | null = 'file'
): Promise<void> {
	if (!['file', 'dir', 'junction'].includes(type!)) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid symlink type: ' + type);
	}

	path = normalizePath(path);

	if (await exists.call(this, path)) throw ErrnoError.With('EEXIST', path, 'symlink');

	await using handle = await _open(this, path, { flag: 'w+', mode: 0o644, preserveSymlinks: true });
	await handle.writeFile(normalizePath(target, true));
	await handle.chmod(constants.S_IFLNK);
}
symlink satisfies typeof promises.symlink;

export async function readlink(this: V_Context, path: fs.PathLike, options: fs.BufferEncodingOption): Promise<Buffer>;
export async function readlink(this: V_Context, path: fs.PathLike, options?: fs.EncodingOption | null): Promise<string>;
export async function readlink(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.BufferEncodingOption | fs.EncodingOption | string | null
): Promise<string | Buffer>;
export async function readlink(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.BufferEncodingOption | fs.EncodingOption | string | null
): Promise<string | Buffer> {
	await using handle = await _open(this, normalizePath(path), { flag: 'r', mode: 0o644, preserveSymlinks: true });
	const value = await handle.readFile();
	const encoding = typeof options == 'object' ? options?.encoding : options;
	// always defaults to utf-8 to avoid wrangler (cloudflare) worker "unknown encoding" exception
	return encoding == 'buffer' ? value : value.toString((encoding ?? 'utf-8') as BufferEncoding);
}
readlink satisfies typeof promises.readlink;

export async function chown(this: V_Context, path: fs.PathLike, uid: number, gid: number): Promise<void> {
	await using handle = await open.call(this, path, 'r+');
	await handle.chown(uid, gid);
}
chown satisfies typeof promises.chown;

export async function lchown(this: V_Context, path: fs.PathLike, uid: number, gid: number): Promise<void> {
	await using handle: FileHandle = await _open(this, path, {
		flag: 'r+',
		mode: 0o644,
		preserveSymlinks: true,
		allowDirectory: true,
	});
	await handle.chown(uid, gid);
}
lchown satisfies typeof promises.lchown;

export async function chmod(this: V_Context, path: fs.PathLike, mode: fs.Mode): Promise<void> {
	await using handle = await open.call(this, path, 'r+');
	await handle.chmod(mode);
}
chmod satisfies typeof promises.chmod;

export async function lchmod(this: V_Context, path: fs.PathLike, mode: fs.Mode): Promise<void> {
	await using handle: FileHandle = await _open(this, path, {
		flag: 'r+',
		mode: 0o644,
		preserveSymlinks: true,
		allowDirectory: true,
	});
	await handle.chmod(mode);
}
lchmod satisfies typeof promises.lchmod;

/**
 * Change file timestamps of the file referenced by the supplied path.
 */
export async function utimes(this: V_Context, path: fs.PathLike, atime: string | number | Date, mtime: string | number | Date): Promise<void> {
	await using handle = await open.call(this, path, 'r+');
	await handle.utimes(atime, mtime);
}
utimes satisfies typeof promises.utimes;

/**
 * Change file timestamps of the file referenced by the supplied path.
 */
export async function lutimes(this: V_Context, path: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike): Promise<void> {
	await using handle: FileHandle = await _open(this, path, {
		flag: 'r+',
		mode: 0o644,
		preserveSymlinks: true,
		allowDirectory: true,
	});
	await handle.utimes(new Date(atime), new Date(mtime));
}
lutimes satisfies typeof promises.lutimes;

/**
 * Resolves the mount and real path for a path.
 * Additionally, any stats fetched will be returned for de-duplication
 * @internal @hidden
 */
async function _resolve($: V_Context, path: string, preserveSymlinks?: boolean): Promise<ResolvedPath> {
	if (preserveSymlinks) {
		const resolved = resolveMount(path, $);
		const stats = await resolved.fs
			.stat(resolved.path)
			.then(i => new Stats(i))
			.catch(() => undefined);
		return { ...resolved, fullPath: path, stats };
	}

	/* Try to resolve it directly. If this works,
	that means we don't need to perform any resolution for parent directories. */
	try {
		const resolved = resolveMount(path, $);

		// Stat it to make sure it exists
		const stats = new Stats(await resolved.fs.stat(resolved.path));

		if (!stats.isSymbolicLink()) {
			return { ...resolved, fullPath: path, stats };
		}

		const target = resolve.call($, dirname(path), (await readlink.call($, path)).toString());
		return await _resolve($, target);
	} catch {
		// Go the long way
	}

	const { base, dir } = parse(path);
	const realDir = dir == '/' ? '/' : await realpath.call($, dir);
	const maybePath = join(realDir, base);
	const resolved = resolveMount(maybePath, $);

	try {
		const stats = new Stats(await resolved.fs.stat(resolved.path));
		if (!stats.isSymbolicLink()) {
			return { ...resolved, fullPath: maybePath, stats };
		}

		const target = resolve.call($, realDir, (await readlink.call($, maybePath)).toString());
		return await _resolve($, target);
	} catch (e) {
		if ((e as ErrnoError).code == 'ENOENT') {
			return { ...resolved, fullPath: path };
		}
		throw fixError(e as ErrnoError, { [resolved.path]: maybePath });
	}
}

/**
 * Asynchronous realpath(3) - return the canonicalized absolute pathname.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. Defaults to `'utf8'`.
 * @todo handle options
 */
export async function realpath(this: V_Context, path: fs.PathLike, options: fs.BufferEncodingOption): Promise<Buffer>;
export async function realpath(this: V_Context, path: fs.PathLike, options?: fs.EncodingOption | BufferEncoding): Promise<string>;
export async function realpath(
	this: V_Context,
	path: fs.PathLike,
	options?: fs.EncodingOption | BufferEncoding | fs.BufferEncodingOption
): Promise<string | Buffer> {
	const encoding = typeof options == 'string' ? options : (options?.encoding ?? 'utf8');
	path = normalizePath(path);

	const { fullPath } = await _resolve(this, path);
	if (encoding == 'utf8' || encoding == 'utf-8') return fullPath;
	const buf = Buffer.from(fullPath, 'utf-8');
	if (encoding == 'buffer') return buf;
	return buf.toString(encoding);
}
realpath satisfies typeof promises.realpath;

export function watch(
	this: V_Context,
	filename: fs.PathLike,
	options?: fs.WatchOptions | BufferEncoding
): AsyncIteratorObject<promises.FileChangeInfo<string>>;
export function watch(
	this: V_Context,
	filename: fs.PathLike,
	options: fs.WatchOptions | fs.BufferEncodingOption
): AsyncIteratorObject<promises.FileChangeInfo<Buffer>>;
export function watch(
	this: V_Context,
	filename: fs.PathLike,
	options?: fs.WatchOptions | string
): AsyncIteratorObject<promises.FileChangeInfo<string>> | AsyncIteratorObject<promises.FileChangeInfo<Buffer>>;
export function watch<T extends string | Buffer>(
	this: V_Context,
	filename: fs.PathLike,
	options: fs.WatchOptions | string = {}
): AsyncIteratorObject<promises.FileChangeInfo<T>> {
	const watcher = new FSWatcher<T>(
		this,
		filename.toString(),
		typeof options !== 'string' ? options : { encoding: options as BufferEncoding | 'buffer' }
	);

	// A queue to hold change events, since we need to resolve them in the async iterator
	const eventQueue: ((value: IteratorResult<promises.FileChangeInfo<T>>) => void)[] = [];

	let done = false;

	watcher.on('change', (eventType: promises.FileChangeInfo<T>['eventType'], filename: T) => {
		eventQueue.shift()?.({ value: { eventType, filename }, done: false });
	});

	function cleanup() {
		done = true;
		watcher.close();
		for (const resolve of eventQueue) {
			resolve({ value: null, done });
		}
		eventQueue.length = 0; // Clear the queue
		return Promise.resolve({ value: null, done: true as const });
	}

	return {
		async next() {
			if (done) return Promise.resolve({ value: null, done });
			const { promise, resolve } = Promise.withResolvers<IteratorResult<promises.FileChangeInfo<T>>>();
			eventQueue.push(resolve);
			return promise;
		},
		return: cleanup,
		throw: cleanup,
		async [Symbol.asyncDispose]() {
			await cleanup();
		},
		[Symbol.asyncIterator](): AsyncIteratorObject<promises.FileChangeInfo<T>> {
			return this;
		},
	};
}
watch satisfies typeof promises.watch;

export async function access(this: V_Context, path: fs.PathLike, mode: number = constants.F_OK): Promise<void> {
	if (!config.checkAccess) return;
	const stats = await stat.call(this, path);
	if (!stats.hasAccess(mode, this)) {
		throw new ErrnoError(Errno.EACCES);
	}
}
access satisfies typeof promises.access;

/**
 * Asynchronous `rm`. Removes files or directories (recursively).
 * @param path The path to the file or directory to remove.
 */
export async function rm(this: V_Context, path: fs.PathLike, options?: fs.RmOptions) {
	path = normalizePath(path);

	const stats = await lstat.call<V_Context, [string], Promise<Stats>>(this, path).catch((error: ErrnoError) => {
		if (error.code == 'ENOENT' && options?.force) return undefined;
		throw error;
	});

	if (!stats) return;

	switch (stats.mode & constants.S_IFMT) {
		case constants.S_IFDIR:
			if (options?.recursive) {
				for (const entry of (await readdir.call(this, path)) as string[]) {
					await rm.call(this, join(path, entry), options);
				}
			}

			await rmdir.call(this, path);
			break;
		case constants.S_IFREG:
		case constants.S_IFLNK:
		case constants.S_IFBLK:
		case constants.S_IFCHR:
			await unlink.call(this, path);
			break;
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
export async function mkdtemp(this: V_Context, prefix: string, options?: fs.EncodingOption): Promise<string>;
export async function mkdtemp(this: V_Context, prefix: string, options?: fs.BufferEncodingOption): Promise<Buffer>;
export async function mkdtemp(this: V_Context, prefix: string, options?: fs.EncodingOption | fs.BufferEncodingOption): Promise<string | Buffer> {
	const encoding = typeof options === 'object' ? options?.encoding : options || 'utf8';
	const fsName = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const resolvedPath = '/tmp/' + fsName;

	await mkdir.call(this, resolvedPath);

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
export async function copyFile(this: V_Context, src: fs.PathLike, dest: fs.PathLike, mode?: number): Promise<void> {
	src = normalizePath(src);
	dest = normalizePath(dest);

	if (mode && mode & constants.COPYFILE_EXCL && (await exists.call(this, dest))) {
		throw new ErrnoError(Errno.EEXIST, 'Destination file already exists', dest, 'copyFile');
	}

	await writeFile.call(this, dest, await readFile.call(this, src));
	emitChange(this, 'rename', dest.toString());
}
copyFile satisfies typeof promises.copyFile;

/**
 * Asynchronous `opendir`. Opens a directory.
 * @param path The path to the directory.
 * @param options Options for opening the directory.
 * @returns A `Dir` object representing the opened directory.
 * @todo Use options
 */
export function opendir(this: V_Context, path: fs.PathLike, options?: fs.OpenDirOptions): Promise<Dir> {
	path = normalizePath(path);
	return Promise.resolve(new Dir(path, this));
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
export async function cp(this: V_Context, source: fs.PathLike, destination: fs.PathLike, opts?: fs.CopyOptions): Promise<void> {
	source = normalizePath(source);
	destination = normalizePath(destination);

	const srcStats = await lstat.call<V_Context, [string], Promise<Stats>>(this, source); // Use lstat to follow symlinks if not dereferencing

	if (opts?.errorOnExist && (await exists.call(this, destination))) {
		throw new ErrnoError(Errno.EEXIST, 'Destination file or directory already exists', destination, 'cp');
	}

	switch (srcStats.mode & constants.S_IFMT) {
		case constants.S_IFDIR: {
			if (!opts?.recursive) {
				throw new ErrnoError(Errno.EISDIR, source + ' is a directory (not copied)', source, 'cp');
			}
			const [entries] = await Promise.all(
				[
					readdir.call<V_Context, [string, any], Promise<Dirent[]>>(this, source, { withFileTypes: true }),
					mkdir.call(this, destination, { recursive: true }),
				] // Ensure the destination directory exists
			);

			const _cp = async (dirent: Dirent) => {
				if (opts.filter && !opts.filter(join(source, dirent.name), join(destination, dirent.name))) {
					return; // Skip if the filter returns false
				}
				await cp.call(this, join(source, dirent.name), join(destination, dirent.name), opts);
			};
			await Promise.all(entries.map(_cp));
			break;
		}
		case constants.S_IFREG:
		case constants.S_IFLNK:
			await copyFile.call(this, source, destination);
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
		await utimes.call(this, destination, srcStats.atime, srcStats.mtime);
	}
}
cp satisfies typeof promises.cp;

/**
 * @since Node v18.15.0
 * @returns Fulfills with an {fs.StatFs} for the file system.
 */
export async function statfs(this: V_Context, path: fs.PathLike, opts?: fs.StatFsOptions & { bigint?: false }): Promise<fs.StatsFs>;
export async function statfs(this: V_Context, path: fs.PathLike, opts: fs.StatFsOptions & { bigint: true }): Promise<fs.BigIntStatsFs>;
export async function statfs(this: V_Context, path: fs.PathLike, opts?: fs.StatFsOptions): Promise<fs.StatsFs | fs.BigIntStatsFs>;
export async function statfs(this: V_Context, path: fs.PathLike, opts?: fs.StatFsOptions): Promise<fs.StatsFs | fs.BigIntStatsFs> {
	path = normalizePath(path);
	const { fs } = resolveMount(path, this);
	return Promise.resolve(_statfs(fs, opts?.bigint));
}

/**
 * Retrieves the files matching the specified pattern.
 */
export function glob(this: V_Context, pattern: string | string[]): NodeJS.AsyncIterator<string>;
export function glob(this: V_Context, pattern: string | string[], opt: fs.GlobOptionsWithFileTypes): NodeJS.AsyncIterator<Dirent>;
export function glob(this: V_Context, pattern: string | string[], opt: fs.GlobOptionsWithoutFileTypes): NodeJS.AsyncIterator<string>;
export function glob(this: V_Context, pattern: string | string[], opt: fs.GlobOptions): NodeJS.AsyncIterator<Dirent | string>;
export function glob(this: V_Context, pattern: string | string[], opt?: GlobOptionsU): NodeJS.AsyncIterator<Dirent | string> {
	pattern = Array.isArray(pattern) ? pattern : [pattern];
	const { cwd = '/', withFileTypes = false, exclude = () => false } = opt || {};

	type Entries = true extends typeof withFileTypes ? Dirent[] : string[];

	// Escape special characters in pattern
	const regexPatterns = pattern.map(p => {
		p = p
			.replace(/([.?+^$(){}|[\]/])/g, '$1')
			.replace(/\*\*/g, '.*')
			.replace(/\*/g, '[^/]*')
			.replace(/\?/g, '.');
		return new RegExp(`^${p}$`);
	});

	async function* recursiveList(dir: string): AsyncGenerator<string | Dirent> {
		const entries = await readdir(dir, { withFileTypes, encoding: 'utf8' });

		for (const entry of entries as Entries) {
			const fullPath = withFileTypes ? entry.path : dir + '/' + entry;
			if (exclude((withFileTypes ? entry : fullPath) as any)) continue;

			/**
			 * @todo is the pattern.source check correct?
			 */
			if ((await stat(fullPath)).isDirectory() && regexPatterns.some(pattern => pattern.source.includes('.*'))) {
				yield* recursiveList(fullPath);
			}

			if (regexPatterns.some(pattern => pattern.test(fullPath.replace(/^\/+/g, '')))) {
				yield withFileTypes ? entry : fullPath.replace(/^\/+/g, '');
			}
		}
	}

	return recursiveList(cwd);
}
glob satisfies typeof promises.glob;
