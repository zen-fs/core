import type { FileReadResult } from 'node:fs/promises';
import { O_APPEND, O_CREAT, O_EXCL, O_RDONLY, O_RDWR, O_SYNC, O_TRUNC, O_WRONLY, S_IFMT } from './emulation/constants.js';
import { Errno, ErrnoError } from './error.js';
import type { FileSystem } from './filesystem.js';
import { size_max } from './inode.js';
import { Stats, type FileType } from './stats.js';

/*
	Typescript does not include a type declaration for resizable array buffers. 
	It has been standardized into ECMAScript though
	Remove this if TS adds them to lib declarations
*/
declare global {
	interface ArrayBuffer {
		readonly resizable: boolean;

		readonly maxByteLength?: number;

		resize(newLength: number): void;
	}

	interface SharedArrayBuffer {
		readonly resizable: boolean;

		readonly maxByteLength?: number;

		resize(newLength: number): void;
	}

	interface ArrayBufferConstructor {
		new (byteLength: number, options: { maxByteLength?: number }): ArrayBuffer;
	}
}

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

export abstract class File {
	/**
	 * Get the current file position.
	 */
	public abstract position: number;

	/**
	 * The path to the file
	 */
	public abstract readonly path: string;

	/**
	 * Asynchronous `stat`.
	 */
	public abstract stat(): Promise<Stats>;

	/**
	 * Synchronous `stat`.
	 */
	public abstract statSync(): Stats;

	/**
	 * Asynchronous close.
	 */
	public abstract close(): Promise<void>;

	/**
	 * Synchronous close.
	 */
	public abstract closeSync(): void;

	public [Symbol.asyncDispose](): Promise<void> {
		return this.close();
	}

	public [Symbol.dispose](): void {
		return this.closeSync();
	}

	/**
	 * Asynchronous truncate.
	 */
	public abstract truncate(len: number): Promise<void>;

	/**
	 * Synchronous truncate.
	 */
	public abstract truncateSync(len: number): void;

	/**
	 * Asynchronous sync.
	 */
	public abstract sync(): Promise<void>;

	/**
	 * Synchronous sync.
	 */
	public abstract syncSync(): void;

	/**
	 * Write buffer to the file.
	 * Note that it is unsafe to use fs.write multiple times on the same file
	 * without waiting for the callback.
	 * @param buffer Uint8Array containing the data to write to
	 *  the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this
	 *   data should be written. If position is null, the data will be written at
	 *   the current position.
	 * @returns Promise resolving to the new length of the buffer
	 */
	public abstract write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number>;

	/**
	 * Write buffer to the file.
	 * Note that it is unsafe to use fs.writeSync multiple times on the same file
	 * without waiting for it to return.
	 * @param buffer Uint8Array containing the data to write to
	 *  the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this
	 *   data should be written. If position is null, the data will be written at
	 *   the current position.
	 */
	public abstract writeSync(buffer: Uint8Array, offset?: number, length?: number, position?: number): number;

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be
	 *   written to.
	 * @param offset The offset within the buffer where writing will
	 *   start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from
	 *   in the file. If position is null, data will be read from the current file
	 *   position.
	 * @returns Promise resolving to the new length of the buffer
	 */
	public abstract read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<FileReadResult<TBuffer>>;

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from
	 *   in the file. If position is null, data will be read from the current file
	 *   position.
	 */
	public abstract readSync(buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number;

	/**
	 * Asynchronous `datasync`.
	 *
	 * Default implementation maps to `sync`.
	 */
	public datasync(): Promise<void> {
		return this.sync();
	}

	/**
	 * Synchronous `datasync`.
	 *
	 * Default implementation maps to `syncSync`.
	 */
	public datasyncSync(): void {
		return this.syncSync();
	}

	/**
	 * Asynchronous `chown`.
	 */
	public abstract chown(uid: number, gid: number): Promise<void>;

	/**
	 * Synchronous `chown`.
	 */
	public abstract chownSync(uid: number, gid: number): void;

	/**
	 * Asynchronous `fchmod`.
	 */
	public abstract chmod(mode: number): Promise<void>;

	/**
	 * Synchronous `fchmod`.
	 */
	public abstract chmodSync(mode: number): void;

	/**
	 * Change the file timestamps of the file.
	 */
	public abstract utimes(atime: Date, mtime: Date): Promise<void>;

	/**
	 * Change the file timestamps of the file.
	 */
	public abstract utimesSync(atime: Date, mtime: Date): void;

	/**
	 * Set the file type
	 * @internal
	 */
	public abstract _setType(type: FileType): Promise<void>;

	/**
	 * Set the file type
	 * @internal
	 */
	public abstract _setTypeSync(type: FileType): void;
}

/**
 * An implementation of the File interface that operates on a file that is
 * completely in-memory. PreloadFiles are backed by a Uint8Array.
 *
 * @todo 'close' lever that disables functionality once closed.
 */
export class PreloadFile<FS extends FileSystem> extends File {
	protected _position: number = 0;
	protected dirty: boolean = false;
	/**
	 * Creates a file with the given path and, optionally, the given contents. Note
	 * that, if contents is specified, it will be mutated by the file!
	 * @param _mode The mode that the file was opened using.
	 *   Dictates permissions and where the file pointer starts.
	 * @param stats The stats object for the given file.
	 *   PreloadFile will mutate this object. Note that this object must contain
	 *   the appropriate mode that the file was opened as.
	 * @param buffer A buffer containing the entire
	 *   contents of the file. PreloadFile will mutate this buffer. If not
	 *   specified, we assume it is a new file.
	 */
	constructor(
		/**
		 * The file system that created the file.
		 */
		protected fs: FS,
		/**
		 * Path to the file
		 */
		public readonly path: string,
		public readonly flag: string,
		public readonly stats: Stats,
		protected _buffer: Uint8Array = new Uint8Array(new ArrayBuffer(0, fs.metadata().noResizableBuffers ? {} : { maxByteLength: size_max }))
	) {
		super();

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
	 * > On Linux, positional writes don't work when the file is opened in append
	 *   mode. The kernel ignores the position argument and always appends the data
	 *   to the end of the file.
	 * @return The current file position.
	 */
	public get position(): number {
		if (isAppendable(this.flag)) {
			return this.stats.size;
		}
		return this._position;
	}

	/**
	 * Set the file position.
	 * @param newPos new position
	 */
	public set position(newPos: number) {
		this._position = newPos;
	}

	public async sync(): Promise<void> {
		if (!this.dirty) {
			return;
		}
		await this.fs.sync(this.path, this._buffer, this.stats);
		this.dirty = false;
	}

	public syncSync(): void {
		if (!this.dirty) {
			return;
		}
		this.fs.syncSync(this.path, this._buffer, this.stats);
		this.dirty = false;
	}

	public async close(): Promise<void> {
		await this.sync();
	}

	public closeSync(): void {
		this.syncSync();
	}

	/**
	 * Asynchronous `stat`.
	 */
	public async stat(): Promise<Stats> {
		return new Stats(this.stats);
	}

	/**
	 * Synchronous `stat`.
	 */
	public statSync(): Stats {
		return new Stats(this.stats);
	}

	protected _truncate(length: number): void {
		this.dirty = true;
		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode.');
		}
		this.stats.mtimeMs = Date.now();
		if (length > this._buffer.length) {
			const data = new Uint8Array(length - this._buffer.length);
			// Write will set stats.size and handle syncing.
			this.writeSync(data, 0, data.length, this._buffer.length);
			return;
		}
		this.stats.size = length;
		// Truncate.
		this._buffer = this._buffer.slice(0, length);
	}

	/**
	 * Asynchronous truncate.
	 * @param length
	 */
	public async truncate(length: number): Promise<void> {
		this._truncate(length);
		await this.sync();
	}

	/**
	 * Synchronous truncate.
	 * @param length
	 */
	public truncateSync(length: number): void {
		this._truncate(length);
		this.syncSync();
	}

	protected _write(buffer: Uint8Array, offset: number = 0, length: number = this.stats.size, position: number = this.position): number {
		this.dirty = true;
		if (!isWriteable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode.');
		}
		const end = position + length;

		if (end > this.stats.size) {
			this.stats.size = end;
			if (end > this._buffer.byteLength) {
				if (this._buffer.buffer.resizable && this._buffer.buffer.maxByteLength! <= end) {
					this._buffer.buffer.resize(end);
				} else {
					// Extend the buffer!
					const newBuffer = new Uint8Array(new ArrayBuffer(end, this.fs.metadata().noResizableBuffers ? {} : { maxByteLength: size_max }));
					newBuffer.set(this._buffer);
					this._buffer = newBuffer;
				}
			}
		}
		const slice = buffer.slice(offset, offset + length);
		this._buffer.set(slice, position);
		this.stats.mtimeMs = Date.now();
		this.position = position + slice.byteLength;
		return slice.byteLength;
	}

	/**
	 * Write buffer to the file.
	 * Note that it is unsafe to use fs.write multiple times on the same file
	 * without waiting for the callback.
	 * @param buffer Uint8Array containing the data to write to
	 *  the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this
	 *   data should be written. If position is null, the data will be written at
	 *   the current position.
	 */
	public async write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number> {
		const bytesWritten = this._write(buffer, offset, length, position);
		await this.sync();
		return bytesWritten;
	}

	/**
	 * Write buffer to the file.
	 * Note that it is unsafe to use fs.writeSync multiple times on the same file
	 * without waiting for the callback.
	 * @param buffer Uint8Array containing the data to write to
	 *  the file.
	 * @param offset Offset in the buffer to start reading data from.
	 * @param length The amount of bytes to write to the file.
	 * @param position Offset from the beginning of the file where this
	 *   data should be written. If position is null, the data will be written at
	 *   the current position.
	 * @returns bytes written
	 */
	public writeSync(buffer: Uint8Array, offset: number = 0, length: number = this.stats.size, position: number = this.position): number {
		const bytesWritten = this._write(buffer, offset, length, position);
		this.syncSync();
		return bytesWritten;
	}

	protected _read(buffer: ArrayBufferView, offset: number = 0, length: number = this.stats.size, position?: number): number {
		if (!isReadable(this.flag)) {
			throw new ErrnoError(Errno.EPERM, 'File not opened with a readable mode.');
		}
		this.dirty = true;
		position ??= this.position;
		let end = position + length;
		if (end > this.stats.size) {
			end = position + Math.max(this.stats.size - position, 0);
		}
		this.stats.atimeMs = Date.now();
		this._position = end;
		const bytesRead = end - position;
		if (bytesRead == 0) {
			// No copy/read. Return immediatly for better performance
			return bytesRead;
		}
		new Uint8Array(buffer.buffer, offset, length).set(this._buffer.slice(position, end));
		return bytesRead;
	}

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be
	 *   written to.
	 * @param offset The offset within the buffer where writing will
	 *   start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from
	 *   in the file. If position is null, data will be read from the current file
	 *   position.
	 */
	public async read<TBuffer extends ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: TBuffer }> {
		const bytesRead = this._read(buffer, offset, length, position);
		await this.sync();
		return { bytesRead, buffer };
	}

	/**
	 * Read data from the file.
	 * @param buffer The buffer that the data will be
	 *   written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from
	 *   in the file. If position is null, data will be read from the current file
	 *   position.
	 * @returns number of bytes written
	 */
	public readSync(buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number {
		const bytesRead = this._read(buffer, offset, length, position);
		this.statSync();
		return bytesRead;
	}

	/**
	 * Asynchronous `fchmod`.
	 * @param mode the mode
	 */
	public async chmod(mode: number): Promise<void> {
		this.dirty = true;
		this.stats.chmod(mode);
		await this.sync();
	}

	/**
	 * Synchronous `fchmod`.
	 * @param mode
	 */
	public chmodSync(mode: number): void {
		this.dirty = true;
		this.stats.chmod(mode);
		this.syncSync();
	}

	/**
	 * Asynchronous `fchown`.
	 * @param uid
	 * @param gid
	 */
	public async chown(uid: number, gid: number): Promise<void> {
		this.dirty = true;
		this.stats.chown(uid, gid);
		await this.sync();
	}

	/**
	 * Synchronous `fchown`.
	 * @param uid
	 * @param gid
	 */
	public chownSync(uid: number, gid: number): void {
		this.dirty = true;
		this.stats.chown(uid, gid);
		this.syncSync();
	}

	public async utimes(atime: Date, mtime: Date): Promise<void> {
		this.dirty = true;
		this.stats.atime = atime;
		this.stats.mtime = mtime;
		await this.sync();
	}

	public utimesSync(atime: Date, mtime: Date): void {
		this.dirty = true;
		this.stats.atime = atime;
		this.stats.mtime = mtime;
		this.syncSync();
	}

	public async _setType(type: FileType): Promise<void> {
		this.dirty = true;
		this.stats.mode = (this.stats.mode & ~S_IFMT) | type;
		await this.sync();
	}

	public _setTypeSync(type: FileType): void {
		this.dirty = true;
		this.stats.mode = (this.stats.mode & ~S_IFMT) | type;
		this.syncSync();
	}
}

/**
 * For the filesystems which do not sync to anything..
 */
export class NoSyncFile<T extends FileSystem> extends PreloadFile<T> {
	constructor(fs: T, path: string, flag: string, stats: Stats, contents?: Uint8Array) {
		super(fs, path, flag, stats, contents);
	}
	/**
	 * Asynchronous sync. Doesn't do anything, simply calls the cb.
	 */
	public async sync(): Promise<void> {
		return;
	}
	/**
	 * Synchronous sync. Doesn't do anything.
	 */
	public syncSync(): void {
		// NOP.
	}
	/**
	 * Asynchronous close. Doesn't do anything, simply calls the cb.
	 */
	public async close(): Promise<void> {
		return;
	}
	/**
	 * Synchronous close. Doesn't do anything.
	 */
	public closeSync(): void {
		// NOP.
	}
}
