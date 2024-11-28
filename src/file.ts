import type { FileReadResult } from 'node:fs/promises';
import { config } from './emulation/config.js';
import { O_APPEND, O_CREAT, O_EXCL, O_RDONLY, O_RDWR, O_SYNC, O_TRUNC, O_WRONLY, S_IFMT, size_max } from './emulation/constants.js';
import { Errno, ErrnoError } from './error.js';
import type { FileSystem } from './filesystem.js';
import './polyfills.js';
import { _chown, Stats } from './stats.js';

const validFlags = ['r', 'r+', 'rs', 'rs+', 'w', 'wx', 'w+', 'wx+', 'a', 'ax', 'a+', 'ax+'];

export function parseFlag(flag: string | number): string {
	if (typeof flag === 'number') {
		return flagToString(flag);
	}
	if (!validFlags.includes(flag)) {
		throw new Error('Invalid flag string: ' + flag);
	}
	return flag;
}

export function flagToString(flag: number): string {
	switch (flag) {
		case O_RDONLY:
			return 'r';
		case O_RDONLY | O_SYNC:
			return 'rs';
		case O_RDWR:
			return 'r+';
		case O_RDWR | O_SYNC:
			return 'rs+';
		case O_TRUNC | O_CREAT | O_WRONLY:
			return 'w';
		case O_TRUNC | O_CREAT | O_WRONLY | O_EXCL:
			return 'wx';
		case O_TRUNC | O_CREAT | O_RDWR:
			return 'w+';
		case O_TRUNC | O_CREAT | O_RDWR | O_EXCL:
			return 'wx+';
		case O_APPEND | O_CREAT | O_WRONLY:
			return 'a';
		case O_APPEND | O_CREAT | O_WRONLY | O_EXCL:
			return 'ax';
		case O_APPEND | O_CREAT | O_RDWR:
			return 'a+';
		case O_APPEND | O_CREAT | O_RDWR | O_EXCL:
			return 'ax+';
		default:
			throw new Error('Invalid flag number: ' + flag);
	}
}

export function flagToNumber(flag: string): number {
	switch (flag) {
		case 'r':
			return O_RDONLY;
		case 'rs':
			return O_RDONLY | O_SYNC;
		case 'r+':
			return O_RDWR;
		case 'rs+':
			return O_RDWR | O_SYNC;
		case 'w':
			return O_TRUNC | O_CREAT | O_WRONLY;
		case 'wx':
			return O_TRUNC | O_CREAT | O_WRONLY | O_EXCL;
		case 'w+':
			return O_TRUNC | O_CREAT | O_RDWR;
		case 'wx+':
			return O_TRUNC | O_CREAT | O_RDWR | O_EXCL;
		case 'a':
			return O_APPEND | O_CREAT | O_WRONLY;
		case 'ax':
			return O_APPEND | O_CREAT | O_WRONLY | O_EXCL;
		case 'a+':
			return O_APPEND | O_CREAT | O_RDWR;
		case 'ax+':
			return O_APPEND | O_CREAT | O_RDWR | O_EXCL;
		default:
			throw new Error('Invalid flag string: ' + flag);
	}
}

/**
 * Parses a flag as a mode (W_OK, R_OK, and/or X_OK)
 * @param flag the flag to parse
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

export function isReadable(flag: string): boolean {
	return flag.indexOf('r') !== -1 || flag.indexOf('+') !== -1;
}

export function isWriteable(flag: string): boolean {
	return flag.indexOf('w') !== -1 || flag.indexOf('a') !== -1 || flag.indexOf('+') !== -1;
}

export function isTruncating(flag: string): boolean {
	return flag.indexOf('w') !== -1;
}

export function isAppendable(flag: string): boolean {
	return flag.indexOf('a') !== -1;
}

export function isSynchronous(flag: string): boolean {
	return flag.indexOf('s') !== -1;
}

export function isExclusive(flag: string): boolean {
	return flag.indexOf('x') !== -1;
}

export abstract class File<FS extends FileSystem = FileSystem> {
	public constructor(
		/**
		 * @internal
		 * The file system that created the file
		 */
		public fs: FileSystem,
		public readonly path: string
	) {}

	/**
	 * Get the current file position.
	 */
	public abstract position: number;

	public abstract stat(): Promise<Stats>;
	public abstract statSync(): Stats;

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
	public abstract read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<FileReadResult<TBuffer>>;

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
	public abstract utimes(atime: Date, mtime: Date): Promise<void>;

	/**
	 * Change the file timestamps of the file.
	 */
	public abstract utimesSync(atime: Date, mtime: Date): void;
}

/**
 * An implementation of `File` that operates completely in-memory.
 * `PreloadFile`s are backed by a `Uint8Array`.
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
		public readonly stats: Stats,
		/**
		 * A buffer containing the entire contents of the file.
		 */
		protected _buffer: Uint8Array = new Uint8Array(new ArrayBuffer(0, fs.metadata().noResizableBuffers ? {} : { maxByteLength: size_max }))
	) {
		super(fs, path);

		/*
			Note: 
			This invariant is *not* maintained once the file starts getting modified.
			It only actually matters if file is readable, as writeable modes may truncate/append to file.
		*/
		if (this.stats.size == _buffer.byteLength) {
			return;
		}

		if (isReadable(this.flag)) {
			throw new Error(`Size mismatch: buffer length ${_buffer.byteLength}, stats size ${this.stats.size}`);
		}

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
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.sync');
		}
		if (!this.dirty) {
			return;
		}
		await this.fs.sync(this.path, this._buffer, this.stats);
		this.dirty = false;
	}

	public syncSync(): void {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.sync');
		}
		if (!this.dirty) {
			return;
		}
		this.fs.syncSync(this.path, this._buffer, this.stats);
		this.dirty = false;
	}

	public async close(): Promise<void> {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.close');
		}
		await this.sync();
		this.dispose();
	}

	public closeSync(): void {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.close');
		}
		this.syncSync();
		this.dispose();
	}

	/**
	 * Cleans up. This will *not* sync the file data to the FS
	 */
	protected dispose(force?: boolean): void {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.dispose');
		}
		if (this.dirty && !force) {
			throw ErrnoError.With('EBUSY', this.path, 'File.dispose');
		}

		// @ts-expect-error 2790
		delete this._buffer;
		// @ts-expect-error 2790
		delete this.stats;

		this.closed = true;
	}

	public stat(): Promise<Stats> {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.stat');
		}
		return Promise.resolve(new Stats(this.stats));
	}

	public statSync(): Stats {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.stat');
		}
		return new Stats(this.stats);
	}

	protected _truncate(length: number): void {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.truncate');
		}
		this.dirty = true;
		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode.');
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
		this._buffer = length ? this._buffer.slice(0, length) : new Uint8Array();
	}

	public async truncate(length: number): Promise<void> {
		this._truncate(length);
		if (config.syncImmediately) await this.sync();
	}

	public truncateSync(length: number): void {
		this._truncate(length);
		if (config.syncImmediately) this.syncSync();
	}

	protected _write(buffer: Uint8Array, offset: number = 0, length: number = this.stats.size, position: number = this.position): number {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.write');
		}

		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode.');
		}

		this.dirty = true;
		const end = position + length;
		const slice = buffer.slice(offset, offset + length);

		if (end > this.stats.size) {
			this.stats.size = end;
			if (end > this._buffer.byteLength) {
				const { buffer } = this._buffer;
				if ('resizable' in buffer && buffer.resizable && buffer.maxByteLength <= end) {
					buffer.resize(end);
				} else if ('growable' in buffer && buffer.growable && buffer.maxByteLength <= end) {
					buffer.grow(end);
				} else if (config.unsafeBufferReplace) {
					this._buffer = slice;
				} else {
					// Extend the buffer!
					const newBuffer = new Uint8Array(new ArrayBuffer(end, this.fs.metadata().noResizableBuffers ? {} : { maxByteLength: size_max }));
					newBuffer.set(this._buffer);
					this._buffer = newBuffer;
				}
			}
		}

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
	public writeSync(buffer: Uint8Array, offset: number = 0, length: number = this.stats.size, position: number = this.position): number {
		const bytesWritten = this._write(buffer, offset, length, position);
		if (config.syncImmediately) this.syncSync();
		return bytesWritten;
	}

	protected _read(buffer: ArrayBufferView, offset: number = 0, length: number = this.stats.size, position?: number): number {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.read');
		}

		if (!isReadable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a readable mode.');
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
		new Uint8Array(buffer.buffer, offset, length).set(this._buffer.slice(position, end));
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
	public async read<TBuffer extends ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: TBuffer }> {
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
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.chmod');
		}
		this.dirty = true;
		this.stats.mode = (this.stats.mode & (mode > S_IFMT ? ~S_IFMT : S_IFMT)) | mode;
		if (config.syncImmediately || mode > S_IFMT) await this.sync();
	}

	public chmodSync(mode: number): void {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.chmod');
		}
		this.dirty = true;
		this.stats.mode = (this.stats.mode & (mode > S_IFMT ? ~S_IFMT : S_IFMT)) | mode;
		if (config.syncImmediately || mode > S_IFMT) this.syncSync();
	}

	public async chown(uid: number, gid: number): Promise<void> {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.chown');
		}
		this.dirty = true;
		_chown(this.stats, uid, gid);
		if (config.syncImmediately) await this.sync();
	}

	public chownSync(uid: number, gid: number): void {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.chown');
		}
		this.dirty = true;
		_chown(this.stats, uid, gid);
		if (config.syncImmediately) this.syncSync();
	}

	public async utimes(atime: Date, mtime: Date): Promise<void> {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.utimes');
		}
		this.dirty = true;
		this.stats.atime = atime;
		this.stats.mtime = mtime;
		if (config.syncImmediately) await this.sync();
	}

	public utimesSync(atime: Date, mtime: Date): void {
		if (this.closed) {
			throw ErrnoError.With('EBADF', this.path, 'File.utimes');
		}
		this.dirty = true;
		this.stats.atime = atime;
		this.stats.mtime = mtime;
		if (config.syncImmediately) this.syncSync();
	}
}

/**
 * For the file systems which do not sync to anything.
 */
export class NoSyncFile<T extends FileSystem> extends PreloadFile<T> {
	public sync(): Promise<void> {
		return Promise.resolve();
	}

	public syncSync(): void {}

	public close(): Promise<void> {
		return Promise.resolve();
	}

	public closeSync(): void {}
}
