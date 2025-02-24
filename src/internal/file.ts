import { extendBuffer } from 'utilium/buffer.js';
import '../polyfills.js';
import { config } from '../vfs/config.js';
import * as c from '../vfs/constants.js';
import { _chown } from '../vfs/stats.js';
import { Errno, ErrnoError } from './error.js';
import type { FileSystem, StreamOptions } from './filesystem.js';
import type { InodeLike } from './inode.js';
import { err, log_deprecated } from './log.js';

const maxByteLength = 0xffff; // 64 KiB

const validFlags = ['r', 'r+', 'rs', 'rs+', 'w', 'wx', 'w+', 'wx+', 'a', 'ax', 'a+', 'ax+'];

/**
 * @internal @hidden
 */
export function parseFlag(flag: string | number): string {
	if (typeof flag === 'number') {
		return flagToString(flag);
	}
	if (!validFlags.includes(flag)) {
		throw new Error('Invalid flag string: ' + flag);
	}
	return flag;
}

/**
 * @internal @hidden
 */
export function flagToString(flag: number): string {
	switch (flag) {
		case c.O_RDONLY:
			return 'r';
		case c.O_RDONLY | c.O_SYNC:
			return 'rs';
		case c.O_RDWR:
			return 'r+';
		case c.O_RDWR | c.O_SYNC:
			return 'rs+';
		case c.O_TRUNC | c.O_CREAT | c.O_WRONLY:
			return 'w';
		case c.O_TRUNC | c.O_CREAT | c.O_WRONLY | c.O_EXCL:
			return 'wx';
		case c.O_TRUNC | c.O_CREAT | c.O_RDWR:
			return 'w+';
		case c.O_TRUNC | c.O_CREAT | c.O_RDWR | c.O_EXCL:
			return 'wx+';
		case c.O_APPEND | c.O_CREAT | c.O_WRONLY:
			return 'a';
		case c.O_APPEND | c.O_CREAT | c.O_WRONLY | c.O_EXCL:
			return 'ax';
		case c.O_APPEND | c.O_CREAT | c.O_RDWR:
			return 'a+';
		case c.O_APPEND | c.O_CREAT | c.O_RDWR | c.O_EXCL:
			return 'ax+';
		default:
			throw new Error('Invalid flag number: ' + flag);
	}
}

/**
 * @internal @hidden
 */
export function flagToNumber(flag: string): number {
	switch (flag) {
		case 'r':
			return c.O_RDONLY;
		case 'rs':
			return c.O_RDONLY | c.O_SYNC;
		case 'r+':
			return c.O_RDWR;
		case 'rs+':
			return c.O_RDWR | c.O_SYNC;
		case 'w':
			return c.O_TRUNC | c.O_CREAT | c.O_WRONLY;
		case 'wx':
			return c.O_TRUNC | c.O_CREAT | c.O_WRONLY | c.O_EXCL;
		case 'w+':
			return c.O_TRUNC | c.O_CREAT | c.O_RDWR;
		case 'wx+':
			return c.O_TRUNC | c.O_CREAT | c.O_RDWR | c.O_EXCL;
		case 'a':
			return c.O_APPEND | c.O_CREAT | c.O_WRONLY;
		case 'ax':
			return c.O_APPEND | c.O_CREAT | c.O_WRONLY | c.O_EXCL;
		case 'a+':
			return c.O_APPEND | c.O_CREAT | c.O_RDWR;
		case 'ax+':
			return c.O_APPEND | c.O_CREAT | c.O_RDWR | c.O_EXCL;
		default:
			throw new Error('Invalid flag string: ' + flag);
	}
}

/**
 * Parses a flag as a mode (W_OK, R_OK, and/or X_OK)
 * @param flag the flag to parse
 * @internal @hidden
 */
export function flagToMode(flag: string): number {
	let mode = 0;
	mode <<= 1;
	mode += +isReadable(flag);
	mode <<= 1;
	mode += +isWriteable(flag);
	mode <<= 1;
	return mode;
}

/** @hidden */
export function isReadable(flag: string): boolean {
	return flag.indexOf('r') !== -1 || flag.indexOf('+') !== -1;
}

/** @hidden */
export function isWriteable(flag: string): boolean {
	return flag.indexOf('w') !== -1 || flag.indexOf('a') !== -1 || flag.indexOf('+') !== -1;
}

/** @hidden */
export function isTruncating(flag: string): boolean {
	return flag.indexOf('w') !== -1;
}

/** @hidden */
export function isAppendable(flag: string): boolean {
	return flag.indexOf('a') !== -1;
}

/** @hidden */
export function isSynchronous(flag: string): boolean {
	return flag.indexOf('s') !== -1;
}

/** @hidden */
export function isExclusive(flag: string): boolean {
	return flag.indexOf('x') !== -1;
}

/** @hidden */
export interface FileReadResult<T extends ArrayBufferView> {
	bytesRead: number;
	buffer: T;
}

/**
 * @category Internals
 */
export abstract class File<FS extends FileSystem = FileSystem> {
	public constructor(
		/**
		 * @internal
		 * The file system that created the file
		 */
		public fs: FS,
		public readonly path: string
	) {}

	/**
	 * Get the current file position.
	 */
	public abstract position: number;

	public abstract stat(): Promise<InodeLike>;
	public abstract statSync(): InodeLike;

	public abstract close(): Promise<void>;
	public abstract closeSync(): void;

	public async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}

	public [Symbol.dispose](): void {
		this.closeSync();
	}

	public abstract truncate(len: number): Promise<void>;
	public abstract truncateSync(len: number): void;

	public abstract sync(): Promise<void>;
	public abstract syncSync(): void;

	/**
	 * Write buffer to the file.
	 * @param buffer Uint8Array containing the data to write to the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this data should be written.
	 * If position is null, the data will be written at the current position.
	 * @returns Promise resolving to the new length of the buffer
	 */
	public abstract write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number>;

	/**
	 * Write buffer to the file.
	 * @param buffer Uint8Array containing the data to write to the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this data should be written.
	 * If position is null, the data will be written at the current position.
	 */
	public abstract writeSync(buffer: Uint8Array, offset?: number, length?: number, position?: number): number;

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from in the file.
	 * If position is null, data will be read from the current file position.
	 * @returns Promise resolving to the new length of the buffer
	 */
	public abstract read<TBuffer extends ArrayBufferView>(
		buffer: TBuffer,
		offset?: number,
		length?: number,
		position?: number
	): Promise<FileReadResult<TBuffer>>;

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from in the file.
	 * If position is null, data will be read from the current file position.
	 */
	public abstract readSync(buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number;

	/**
	 * Default implementation maps to `sync`.
	 */
	public datasync(): Promise<void> {
		return this.sync();
	}

	/**
	 * Default implementation maps to `syncSync`.
	 */
	public datasyncSync(): void {
		return this.syncSync();
	}

	public abstract chown(uid: number, gid: number): Promise<void>;
	public abstract chownSync(uid: number, gid: number): void;

	public abstract chmod(mode: number): Promise<void>;
	public abstract chmodSync(mode: number): void;

	/**
	 * Change the file timestamps of the file.
	 */
	public abstract utimes(atime: number, mtime: number): Promise<void>;

	/**
	 * Change the file timestamps of the file.
	 */
	public abstract utimesSync(atime: number, mtime: number): void;

	/**
	 * Create a stream for reading the file.
	 */
	public streamRead(options: StreamOptions): ReadableStream {
		return this.fs.streamRead(this.path, options);
	}

	/**
	 * Create a stream for writing the file.
	 */
	public streamWrite(options: StreamOptions): WritableStream {
		return this.fs.streamWrite(this.path, options);
	}
}

/**
 * An implementation of `File` that operates completely in-memory.
 * `PreloadFile`s are backed by a `Uint8Array`.
 * @category Internals
 */
export class PreloadFile<FS extends FileSystem> extends File<FS> {
	/**
	 * Current position
	 */
	protected _position: number = 0;

	/**
	 * Whether the file has changes which have not been written to the FS
	 */
	protected dirty: boolean = false;

	/**
	 * Whether the file is open or closed
	 */
	protected closed: boolean = false;

	/**
	 * Creates a file with `path` and, optionally, the given contents.
	 * Note that, if contents is specified, it will be mutated by the file.
	 */
	public constructor(
		fs: FS,
		path: string,
		public readonly flag: string,
		public readonly stats: InodeLike,
		/**
		 * A buffer containing the entire contents of the file.
		 */
		protected _buffer: Uint8Array = new Uint8Array(new ArrayBuffer(0, fs.attributes.has('no_buffer_resize') ? {} : { maxByteLength }))
	) {
		super(fs, path);

		/*
			Note: 
			This invariant is *not* maintained once the file starts getting modified.
			It only actually matters if file is readable, as writeable modes may truncate/append to file.
		*/
		if (this.stats.size == _buffer.byteLength) return;

		if (!isWriteable(this.flag)) {
			throw err(new ErrnoError(Errno.EIO, `Size mismatch: buffer length ${_buffer.byteLength}, stats size ${this.stats.size}`, path));
		}

		this.stats.size = _buffer.byteLength;
		this.dirty = true;
	}

	/**
	 * Get the underlying buffer for this file. Mutating not recommended and will mess up dirty tracking.
	 */
	public get buffer(): Uint8Array {
		return this._buffer;
	}

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
		if (isAppendable(this.flag)) {
			return this.stats.size;
		}
		return this._position;
	}

	public set position(value: number) {
		this._position = value;
	}

	public async sync(): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'sync');
		if (!this.dirty) return;

		if (!this.fs.attributes.has('no_write')) await this.fs.sync(this.path, this._buffer, this.stats);
		this.dirty = false;
	}

	public syncSync(): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'sync');
		if (!this.dirty) return;

		if (!this.fs.attributes.has('no_write')) this.fs.syncSync(this.path, this._buffer, this.stats);
		this.dirty = false;
	}

	public async close(): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'close');
		await this.sync();
		this.dispose();
	}

	public closeSync(): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'close');
		this.syncSync();
		this.dispose();
	}

	/**
	 * Cleans up. This will *not* sync the file data to the FS
	 */
	protected dispose(force?: boolean): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'dispose');
		if (this.dirty && !force) {
			throw ErrnoError.With('EBUSY', this.path, 'dispose');
		}

		this.closed = true;
	}

	public stat(): Promise<InodeLike> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'stat');
		return Promise.resolve(this.stats);
	}

	public statSync(): InodeLike {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'stat');
		return this.stats;
	}

	protected _truncate(length: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'truncate');
		this.dirty = true;
		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode');
		}
		this.stats.mtimeMs = Date.now();
		if (length > this._buffer.length) {
			const data = new Uint8Array(length - this._buffer.length);
			// Write will set stats.size and handle syncing.
			this._write(data, 0, data.length, this._buffer.length);
			return;
		}
		this.stats.size = length;
		// Truncate.
		this._buffer = length ? this._buffer.subarray(0, length) : new Uint8Array();
	}

	public async truncate(length: number): Promise<void> {
		this._truncate(length);
		if (config.syncImmediately) await this.sync();
	}

	public truncateSync(length: number): void {
		this._truncate(length);
		if (config.syncImmediately) this.syncSync();
	}

	protected _write(buffer: Uint8Array, offset: number = 0, length: number = buffer.byteLength - offset, position: number = this.position): number {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'write');

		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode');
		}

		this.dirty = true;
		const end = position + length;
		const slice = buffer.subarray(offset, offset + length);

		this._buffer = extendBuffer(this._buffer, end);
		if (end > this.stats.size) this.stats.size = end;

		this._buffer.set(slice, position);
		this.stats.mtimeMs = Date.now();
		this.position = position + slice.byteLength;
		return slice.byteLength;
	}

	/**
	 * Write buffer to the file.
	 * @param buffer Uint8Array containing the data to write to the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this data should be written.
	 * If position is null, the data will be written at  the current position.
	 */
	public async write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number> {
		const bytesWritten = this._write(buffer, offset, length, position);
		if (config.syncImmediately) await this.sync();
		return bytesWritten;
	}

	/**
	 * Write buffer to the file.
	 * @param buffer Uint8Array containing the data to write to the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this data should be written.
	 * If position is null, the data will be written at  the current position.
	 * @returns bytes written
	 */
	public writeSync(buffer: Uint8Array, offset?: number, length?: number, position?: number): number {
		const bytesWritten = this._write(buffer, offset, length, position);
		if (config.syncImmediately) this.syncSync();
		return bytesWritten;
	}

	protected _read(buffer: ArrayBufferView, offset: number = 0, length: number = buffer.byteLength - offset, position?: number): number {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'read');

		if (!isReadable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a readable mode');
		}

		if (config.updateOnRead) {
			this.dirty = true;
		}

		this.stats.atimeMs = Date.now();

		position ??= this.position;
		let end = position + length;
		if (end > this.stats.size) {
			end = position + Math.max(this.stats.size - position, 0);
		}
		this._position = end;
		const bytesRead = end - position;
		if (bytesRead == 0) {
			// No copy/read. Return immediately for better performance
			return bytesRead;
		}
		const slice = this._buffer.subarray(position, end);
		new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).set(slice, offset);
		return bytesRead;
	}

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from in the file.
	 * If position is null, data will be read from the current file position.
	 */
	public async read<TBuffer extends ArrayBufferView>(
		buffer: TBuffer,
		offset?: number,
		length?: number,
		position?: number
	): Promise<{ bytesRead: number; buffer: TBuffer }> {
		const bytesRead = this._read(buffer, offset, length, position);
		if (config.syncImmediately) await this.sync();
		return { bytesRead, buffer };
	}

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from in the file.
	 * If position is null, data will be read from the current file position.
	 * @returns number of bytes written
	 */
	public readSync(buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number {
		const bytesRead = this._read(buffer, offset, length, position);
		if (config.syncImmediately) this.syncSync();
		return bytesRead;
	}

	public async chmod(mode: number): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chmod');
		this.dirty = true;
		this.stats.mode = (this.stats.mode & (mode > c.S_IFMT ? ~c.S_IFMT : c.S_IFMT)) | mode;
		if (config.syncImmediately || mode > c.S_IFMT) await this.sync();
	}

	public chmodSync(mode: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chmod');
		this.dirty = true;
		this.stats.mode = (this.stats.mode & (mode > c.S_IFMT ? ~c.S_IFMT : c.S_IFMT)) | mode;
		if (config.syncImmediately || mode > c.S_IFMT) this.syncSync();
	}

	public async chown(uid: number, gid: number): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chown');
		this.dirty = true;
		_chown(this.stats, uid, gid);
		if (config.syncImmediately) await this.sync();
	}

	public chownSync(uid: number, gid: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chown');
		this.dirty = true;
		_chown(this.stats, uid, gid);
		if (config.syncImmediately) this.syncSync();
	}

	public async utimes(atime: number, mtime: number): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'utimes');
		this.dirty = true;
		this.stats.atimeMs = atime;
		this.stats.mtimeMs = mtime;
		if (config.syncImmediately) await this.sync();
	}

	public utimesSync(atime: number, mtime: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'utimes');
		this.dirty = true;
		this.stats.atimeMs = atime;
		this.stats.mtimeMs = mtime;
		if (config.syncImmediately) this.syncSync();
	}
}

/* node:coverage disable */
/**
 * For the file systems which do not sync to anything.
 * @category Internals
 * @deprecated
 */
export class NoSyncFile<T extends FileSystem> extends PreloadFile<T> {
	public constructor(...args: ConstructorParameters<typeof PreloadFile<T>>) {
		log_deprecated('NoSyncFile');
		super(...args);
	}

	public sync(): Promise<void> {
		return Promise.resolve();
	}

	public syncSync(): void {}

	public close(): Promise<void> {
		return Promise.resolve();
	}

	public closeSync(): void {}
}
/* node:coverage enable */

/**
 * An implementation of `File` that uses the FS
 * @category Internals
 */
export class LazyFile<FS extends FileSystem> extends File<FS> {
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
		return isAppendable(this.flag) ? this.stats.size : this._position;
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

	/**
	 * Creates a file with `path` and, optionally, the given contents.
	 * Note that, if contents is specified, it will be mutated by the file.
	 */
	public constructor(
		fs: FS,
		path: string,
		public readonly flag: string,
		public readonly stats: InodeLike
	) {
		super(fs, path);
	}

	public async sync(): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'sync');

		if (!this.dirty) return;

		if (!this.fs.attributes.has('no_write')) await this.fs.sync(this.path, undefined, this.stats);
		this.dirty = false;
	}

	public syncSync(): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'sync');

		if (!this.dirty) return;

		if (!this.fs.attributes.has('no_write')) this.fs.syncSync(this.path, undefined, this.stats);
		this.dirty = false;
	}

	public async close(): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'close');
		await this.sync();
		this.dispose();
	}

	public closeSync(): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'close');
		this.syncSync();
		this.dispose();
	}

	/**
	 * Cleans up. This will *not* sync the file data to the FS
	 */
	protected dispose(force?: boolean): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'dispose');

		if (this.dirty && !force) throw ErrnoError.With('EBUSY', this.path, 'dispose');

		this.closed = true;
	}

	public stat(): Promise<InodeLike> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'stat');

		return Promise.resolve(this.stats);
	}

	public statSync(): InodeLike {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'stat');

		return this.stats;
	}

	public async truncate(length: number): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'truncate');

		this.dirty = true;
		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode');
		}
		this.stats.mtimeMs = Date.now();
		this.stats.size = length;
		if (config.syncImmediately) await this.sync();
	}

	public truncateSync(length: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'truncate');

		this.dirty = true;
		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode');
		}
		this.stats.mtimeMs = Date.now();
		this.stats.size = length;
		if (config.syncImmediately) this.syncSync();
	}

	protected prepareWrite(buffer: Uint8Array, offset: number, length: number, position: number): Uint8Array {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'write');

		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode');
		}

		this.dirty = true;
		const end = position + length;
		const slice = buffer.subarray(offset, offset + length);

		if (end > this.stats.size) this.stats.size = end;

		this.stats.mtimeMs = Date.now();
		this._position = position + slice.byteLength;
		return slice;
	}

	/**
	 * Write buffer to the file.
	 * @param buffer Uint8Array containing the data to write to the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this data should be written.
	 * If position is null, the data will be written at  the current position.
	 */
	public async write(
		buffer: Uint8Array,
		offset: number = 0,
		length: number = buffer.byteLength - offset,
		position: number = this.position
	): Promise<number> {
		const slice = this.prepareWrite(buffer, offset, length, position);
		await this.fs.write(this.path, slice, position);
		if (config.syncImmediately) await this.sync();
		return slice.byteLength;
	}

	/**
	 * Write buffer to the file.
	 * @param buffer Uint8Array containing the data to write to the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this data should be written.
	 * If position is null, the data will be written at  the current position.
	 * @returns bytes written
	 */
	public writeSync(buffer: Uint8Array, offset: number = 0, length: number = buffer.byteLength - offset, position: number = this.position): number {
		const slice = this.prepareWrite(buffer, offset, length, position);
		this.fs.writeSync(this.path, slice, position);
		if (config.syncImmediately) this.syncSync();
		return slice.byteLength;
	}

	/**
	 * Computes position information for reading
	 */
	protected prepareRead(length: number, position: number): number {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'read');

		if (!isReadable(this.flag)) throw new ErrnoError(Errno.EPERM, 'File not opened with a readable mode');

		if (config.updateOnRead) this.dirty = true;

		this.stats.atimeMs = Date.now();

		let end = position + length;
		if (end > this.stats.size) {
			end = position + Math.max(this.stats.size - position, 0);
		}
		this._position = end;
		return end;
	}

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from in the file.
	 * If position is unset, data will be read from the current file position.
	 */
	public async read<TBuffer extends ArrayBufferView>(
		buffer: TBuffer,
		offset: number = 0,
		length: number = buffer.byteLength - offset,
		position: number = this.position
	): Promise<{ bytesRead: number; buffer: TBuffer }> {
		const end = this.prepareRead(length, position);
		const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		await this.fs.read(this.path, uint8.subarray(offset, offset + length), position, end);
		if (config.syncImmediately) await this.sync();
		return { bytesRead: end - position, buffer };
	}

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from in the file.
	 * If position is null, data will be read from the current file position.
	 * @returns number of bytes written
	 */
	public readSync(
		buffer: ArrayBufferView,
		offset: number = 0,
		length: number = buffer.byteLength - offset,
		position: number = this.position
	): number {
		const end = this.prepareRead(length, position);
		const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		this.fs.readSync(this.path, uint8.subarray(offset, offset + length), position, end);
		if (config.syncImmediately) this.syncSync();
		return end - position;
	}

	public async chmod(mode: number): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chmod');
		this.dirty = true;
		this.stats.mode = (this.stats.mode & (mode > c.S_IFMT ? ~c.S_IFMT : c.S_IFMT)) | mode;
		if (config.syncImmediately || mode > c.S_IFMT) await this.sync();
	}

	public chmodSync(mode: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chmod');
		this.dirty = true;
		this.stats.mode = (this.stats.mode & (mode > c.S_IFMT ? ~c.S_IFMT : c.S_IFMT)) | mode;
		if (config.syncImmediately || mode > c.S_IFMT) this.syncSync();
	}

	public async chown(uid: number, gid: number): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chown');
		this.dirty = true;
		_chown(this.stats, uid, gid);
		if (config.syncImmediately) await this.sync();
	}

	public chownSync(uid: number, gid: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chown');
		this.dirty = true;
		_chown(this.stats, uid, gid);
		if (config.syncImmediately) this.syncSync();
	}

	public async utimes(atime: number, mtime: number): Promise<void> {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'utimes');

		this.dirty = true;
		this.stats.atimeMs = atime;
		this.stats.mtimeMs = mtime;
		if (config.syncImmediately) await this.sync();
	}

	public utimesSync(atime: number, mtime: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'utimes');

		this.dirty = true;
		this.stats.atimeMs = atime;
		this.stats.mtimeMs = mtime;
		if (config.syncImmediately) this.syncSync();
	}
}
