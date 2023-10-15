import { ApiError, ErrorCode } from './ApiError.js';
import { Stats } from './stats.js';
import { FileSystem } from './filesystem.js';
import { getMount } from './emulation/shared.js';

export enum ActionType {
	// Indicates that the code should not do anything.
	NOP = 0,
	// Indicates that the code should throw an exception.
	THROW_EXCEPTION = 1,
	// Indicates that the code should truncate the file, but only if it is a file.
	TRUNCATE_FILE = 2,
	// Indicates that the code should create the file.
	CREATE_FILE = 3,
}

/**
 * Represents one of the following file flags. A convenience object.
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
 * Exclusive mode ensures that the file path is newly created.
 */
export class FileFlag {
	// Contains cached FileMode instances.
	private static flagCache: Map<string, FileFlag> = new Map();
	// Array of valid mode strings.
	private static validFlagStrs = ['r', 'r+', 'rs', 'rs+', 'w', 'wx', 'w+', 'wx+', 'a', 'ax', 'a+', 'ax+'];

	/**
	 * Get an object representing the given file flag.
	 * @param modeStr The string representing the flag
	 * @return The FileFlag object representing the flag
	 * @throw when the flag string is invalid
	 */
	public static getFileFlag(flagStr: string): FileFlag {
		// Check cache first.
		if (!FileFlag.flagCache.has(flagStr)) {
			FileFlag.flagCache.set(flagStr, new FileFlag(flagStr));
		}
		return FileFlag.flagCache.get(flagStr);
	}

	private flagStr: string;
	/**
	 * This should never be called directly.
	 * @param modeStr The string representing the mode
	 * @throw when the mode string is invalid
	 */
	constructor(flagStr: string) {
		this.flagStr = flagStr;
		if (FileFlag.validFlagStrs.indexOf(flagStr) < 0) {
			throw new ApiError(ErrorCode.EINVAL, 'Invalid flag: ' + flagStr);
		}
	}

	/**
	 * Get the underlying flag string for this flag.
	 */
	public getFlagString(): string {
		return this.flagStr;
	}

	/**
	 * Get the equivalent mode (0b0xxx: read, write, execute)
	 * Note: Execute will always be 0
	 */
	public getMode(): number {
		let mode = 0;
		mode <<= 1;
		mode += +this.isReadable();
		mode <<= 1;
		mode += +this.isWriteable();
		mode <<= 1;
		return mode;
	}

	/**
	 * Returns true if the file is readable.
	 */
	public isReadable(): boolean {
		return this.flagStr.indexOf('r') !== -1 || this.flagStr.indexOf('+') !== -1;
	}
	/**
	 * Returns true if the file is writeable.
	 */
	public isWriteable(): boolean {
		return this.flagStr.indexOf('w') !== -1 || this.flagStr.indexOf('a') !== -1 || this.flagStr.indexOf('+') !== -1;
	}
	/**
	 * Returns true if the file mode should truncate.
	 */
	public isTruncating(): boolean {
		return this.flagStr.indexOf('w') !== -1;
	}
	/**
	 * Returns true if the file is appendable.
	 */
	public isAppendable(): boolean {
		return this.flagStr.indexOf('a') !== -1;
	}
	/**
	 * Returns true if the file is open in synchronous mode.
	 */
	public isSynchronous(): boolean {
		return this.flagStr.indexOf('s') !== -1;
	}
	/**
	 * Returns true if the file is open in exclusive mode.
	 */
	public isExclusive(): boolean {
		return this.flagStr.indexOf('x') !== -1;
	}
	/**
	 * Returns one of the static fields on this object that indicates the
	 * appropriate response to the path existing.
	 */
	public pathExistsAction(): ActionType {
		if (this.isExclusive()) {
			return ActionType.THROW_EXCEPTION;
		} else if (this.isTruncating()) {
			return ActionType.TRUNCATE_FILE;
		} else {
			return ActionType.NOP;
		}
	}
	/**
	 * Returns one of the static fields on this object that indicates the
	 * appropriate response to the path not existing.
	 */
	public pathNotExistsAction(): ActionType {
		if ((this.isWriteable() || this.isAppendable()) && this.flagStr !== 'r+') {
			return ActionType.CREATE_FILE;
		} else {
			return ActionType.THROW_EXCEPTION;
		}
	}
}

export interface File {
	/**
	 * **Core**: Get the current file position.
	 */
	getPos(): number | undefined;
	/**
	 * **Core**: Asynchronous `stat`.
	 */
	stat(): Promise<Stats>;
	/**
	 * **Core**: Synchronous `stat`.
	 */
	statSync(): Stats;
	/**
	 * **Core**: Asynchronous close.
	 */
	close(): Promise<void>;
	/**
	 * **Core**: Synchronous close.
	 */
	closeSync(): void;
	/**
	 * **Core**: Asynchronous truncate.
	 */
	truncate(len: number): Promise<void>;
	/**
	 * **Core**: Synchronous truncate.
	 */
	truncateSync(len: number): void;
	/**
	 * **Core**: Asynchronous sync.
	 */
	sync(): Promise<void>;
	/**
	 * **Core**: Synchronous sync.
	 */
	syncSync(): void;
	/**
	 * **Core**: Write buffer to the file.
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
	write(buffer: Uint8Array, offset: number, length: number, position: number | null): Promise<number>;
	/**
	 * **Core**: Write buffer to the file.
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
	writeSync(buffer: Uint8Array, offset: number, length: number, position: number | null): number;
	/**
	 * **Core**: Read data from the file.
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
	read(buffer: Uint8Array, offset: number, length: number, position: number | null): Promise<{ bytesRead: number; buffer: Uint8Array }>;
	/**
	 * **Core**: Read data from the file.
	 * @param buffer The buffer that the data will be written to.
	 * @param offset The offset within the buffer where writing will start.
	 * @param length An integer specifying the number of bytes to read.
	 * @param position An integer specifying where to begin reading from
	 *   in the file. If position is null, data will be read from the current file
	 *   position.
	 */
	readSync(buffer: Uint8Array, offset: number, length: number, position: number): number;
	/**
	 * **Supplementary**: Asynchronous `datasync`.
	 *
	 * Default implementation maps to `sync`.
	 */
	datasync(): Promise<void>;
	/**
	 * **Supplementary**: Synchronous `datasync`.
	 *
	 * Default implementation maps to `syncSync`.
	 */
	datasyncSync(): void;
	/**
	 * **Optional**: Asynchronous `chown`.
	 */
	chown(uid: number, gid: number): Promise<void>;
	/**
	 * **Optional**: Synchronous `chown`.
	 */
	chownSync(uid: number, gid: number): void;
	/**
	 * **Optional**: Asynchronous `fchmod`.
	 */
	chmod(mode: number): Promise<void>;
	/**
	 * **Optional**: Synchronous `fchmod`.
	 */
	chmodSync(mode: number): void;
	/**
	 * **Optional**: Change the file timestamps of the file.
	 */
	utimes(atime: Date, mtime: Date): Promise<void>;
	/**
	 * **Optional**: Change the file timestamps of the file.
	 */
	utimesSync(atime: Date, mtime: Date): void;
}

/**
 * Base class that contains shared implementations of functions for the file
 * object.
 */
export class BaseFile {
	public async sync(): Promise<void> {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	public syncSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	public async datasync(): Promise<void> {
		return this.sync();
	}
	public datasyncSync(): void {
		return this.syncSync();
	}
	public async chown(uid: number, gid: number): Promise<void> {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	public chownSync(uid: number, gid: number): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	public async chmod(mode: number): Promise<void> {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	public chmodSync(mode: number): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	public async utimes(atime: Date, mtime: Date): Promise<void> {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	public utimesSync(atime: Date, mtime: Date): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
}

/**
 * An implementation of the File interface that operates on a file that is
 * completely in-memory. PreloadFiles are backed by a Uint8Array.
 *
 * This is also an abstract class, as it lacks an implementation of 'sync' and
 * 'close'. Each filesystem that wishes to use this file representation must
 * extend this class and implement those two methods.
 * @todo 'close' lever that disables functionality once closed.
 */
export class PreloadFile<T extends FileSystem> extends BaseFile {
	protected _fs: T;
	protected _pos: number = 0;
	protected _path: string;
	protected _stat: Stats;
	protected _flag: FileFlag;
	protected _buffer: Uint8Array;
	protected _dirty: boolean = false;
	/**
	 * Creates a file with the given path and, optionally, the given contents. Note
	 * that, if contents is specified, it will be mutated by the file!
	 * @param _fs The file system that created the file.
	 * @param _path
	 * @param _mode The mode that the file was opened using.
	 *   Dictates permissions and where the file pointer starts.
	 * @param _stat The stats object for the given file.
	 *   PreloadFile will mutate this object. Note that this object must contain
	 *   the appropriate mode that the file was opened as.
	 * @param contents A buffer containing the entire
	 *   contents of the file. PreloadFile will mutate this buffer. If not
	 *   specified, we assume it is a new file.
	 */
	constructor(_fs: T, _path: string, _flag: FileFlag, _stat: Stats, contents?: Uint8Array) {
		super();
		this._fs = _fs;
		this._path = _path;
		this._flag = _flag;
		this._stat = _stat;
		this._buffer = contents ? contents : new Uint8Array(0);
		// Note: This invariant is *not* maintained once the file starts getting
		// modified.
		// Note: Only actually matters if file is readable, as writeable modes may
		// truncate/append to file.
		if (this._stat.size !== this._buffer.length && this._flag.isReadable()) {
			throw new Error(`Invalid buffer: Uint8Array is ${this._buffer.length} long, yet Stats object specifies that file is ${this._stat.size} long.`);
		}
	}

	/**
	 * NONSTANDARD: Get the underlying buffer for this file. !!DO NOT MUTATE!! Will mess up dirty tracking.
	 */
	public getBuffer(): Uint8Array {
		return this._buffer;
	}

	/**
	 * NONSTANDARD: Get underlying stats for this file. !!DO NOT MUTATE!!
	 */
	public getStats(): Stats {
		return this._stat;
	}

	public getFlag(): FileFlag {
		return this._flag;
	}

	/**
	 * Get the path to this file.
	 * @return [String] The path to the file.
	 */
	public getPath(): string {
		return this._path;
	}

	/**
	 * Get the current file position.
	 *
	 * We emulate the following bug mentioned in the Node documentation:
	 * > On Linux, positional writes don't work when the file is opened in append
	 *   mode. The kernel ignores the position argument and always appends the data
	 *   to the end of the file.
	 * @return [Number] The current file position.
	 */
	public getPos(): number {
		if (this._flag.isAppendable()) {
			return this._stat.size;
		}
		return this._pos;
	}

	/**
	 * Advance the current file position by the indicated number of positions.
	 * @param [Number] delta
	 */
	public advancePos(delta: number): number {
		return (this._pos += delta);
	}

	/**
	 * Set the file position.
	 * @param [Number] newPos
	 */
	public setPos(newPos: number): number {
		return (this._pos = newPos);
	}

	/**
	 * **Core**: Asynchronous sync. Must be implemented by subclasses of this
	 * class.
	 * @param [Function(BrowserFS.ApiError)] cb
	 */
	public async sync(): Promise<void> {
		this.syncSync();
	}

	/**
	 * **Core**: Synchronous sync.
	 */
	public syncSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	/**
	 * **Core**: Asynchronous close. Must be implemented by subclasses of this
	 * class.
	 * @param [Function(BrowserFS.ApiError)] cb
	 */
	public async close(): Promise<void> {
		this.closeSync();
	}

	/**
	 * **Core**: Synchronous close.
	 */
	public closeSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	/**
	 * Asynchronous `stat`.
	 * @param [Function(BrowserFS.ApiError, BrowserFS.node.fs.Stats)] cb
	 */
	public async stat(): Promise<Stats> {
		return Stats.clone(this._stat);
	}

	/**
	 * Synchronous `stat`.
	 */
	public statSync(): Stats {
		return Stats.clone(this._stat);
	}

	/**
	 * Asynchronous truncate.
	 * @param [Number] len
	 * @param [Function(BrowserFS.ApiError)] cb
	 */
	public truncate(len: number): Promise<void> {
		this.truncateSync(len);
		if (this._flag.isSynchronous() && !getMount('/')!.metadata.synchronous) {
			return this.sync();
		}
	}

	/**
	 * Synchronous truncate.
	 * @param [Number] len
	 */
	public truncateSync(len: number): void {
		this._dirty = true;
		if (!this._flag.isWriteable()) {
			throw new ApiError(ErrorCode.EPERM, 'File not opened with a writeable mode.');
		}
		this._stat.mtimeMs = Date.now();
		if (len > this._buffer.length) {
			const buf = new Uint8Array(len - this._buffer.length);
			// Write will set @_stat.size for us.
			this.writeSync(buf, 0, buf.length, this._buffer.length);
			if (this._flag.isSynchronous() && getMount('/')!.metadata.synchronous) {
				this.syncSync();
			}
			return;
		}
		this._stat.size = len;
		// Truncate buffer to 'len'.
		this._buffer = this._buffer.subarray(0, len);
		if (this._flag.isSynchronous() && getMount('/')!.metadata.synchronous) {
			this.syncSync();
		}
	}

	/**
	 * Write buffer to the file.
	 * Note that it is unsafe to use fs.write multiple times on the same file
	 * without waiting for the callback.
	 * @param [BrowserFS.node.Uint8Array] buffer Uint8Array containing the data to write to
	 *  the file.
	 * @param [Number] offset Offset in the buffer to start reading data from.
	 * @param [Number] length The amount of bytes to write to the file.
	 * @param [Number] position Offset from the beginning of the file where this
	 *   data should be written. If position is null, the data will be written at
	 *   the current position.
	 * @param [Function(BrowserFS.ApiError, Number, BrowserFS.node.Uint8Array)]
	 *   cb The number specifies the number of bytes written into the file.
	 */
	public async write(buffer: Uint8Array, offset: number, length: number, position: number): Promise<number> {
		return this.writeSync(buffer, offset, length, position);
	}

	/**
	 * Write buffer to the file.
	 * Note that it is unsafe to use fs.writeSync multiple times on the same file
	 * without waiting for the callback.
	 * @param [BrowserFS.node.Uint8Array] buffer Uint8Array containing the data to write to
	 *  the file.
	 * @param [Number] offset Offset in the buffer to start reading data from.
	 * @param [Number] length The amount of bytes to write to the file.
	 * @param [Number] position Offset from the beginning of the file where this
	 *   data should be written. If position is null, the data will be written at
	 *   the current position.
	 * @return [Number]
	 */
	public writeSync(buffer: Uint8Array, offset: number, length: number, position: number): number {
		this._dirty = true;
		if (position === undefined || position === null) {
			position = this.getPos();
		}
		if (!this._flag.isWriteable()) {
			throw new ApiError(ErrorCode.EPERM, 'File not opened with a writeable mode.');
		}
		const endFp = position + length;
		if (endFp > this._stat.size) {
			this._stat.size = endFp;
			if (endFp > this._buffer.length) {
				// Extend the buffer!
				const newBuffer = new Uint8Array(endFp);
				newBuffer.set(this._buffer);
				this._buffer = newBuffer;
			}
		}
		this._buffer.set(buffer.slice(offset, offset + length), position);
		const len = this._buffer.length;
		this._stat.mtimeMs = Date.now();
		if (this._flag.isSynchronous()) {
			this.syncSync();
			return len;
		}
		this.setPos(position + len);
		return len;
	}

	/**
	 * Read data from the file.
	 * @param [BrowserFS.node.Uint8Array] buffer The buffer that the data will be
	 *   written to.
	 * @param [Number] offset The offset within the buffer where writing will
	 *   start.
	 * @param [Number] length An integer specifying the number of bytes to read.
	 * @param [Number] position An integer specifying where to begin reading from
	 *   in the file. If position is null, data will be read from the current file
	 *   position.
	 * @param [Function(BrowserFS.ApiError, Number, BrowserFS.node.Uint8Array)] cb The
	 *   number is the number of bytes read
	 */
	public async read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number; buffer: Uint8Array }> {
		return { bytesRead: this.readSync(buffer, offset, length, position), buffer };
	}

	/**
	 * Read data from the file.
	 * @param [BrowserFS.node.Uint8Array] buffer The buffer that the data will be
	 *   written to.
	 * @param [Number] offset The offset within the buffer where writing will
	 *   start.
	 * @param [Number] length An integer specifying the number of bytes to read.
	 * @param [Number] position An integer specifying where to begin reading from
	 *   in the file. If position is null, data will be read from the current file
	 *   position.
	 * @return [Number]
	 */
	public readSync(buffer: Uint8Array, offset: number, length: number, position: number): number {
		if (!this._flag.isReadable()) {
			throw new ApiError(ErrorCode.EPERM, 'File not opened with a readable mode.');
		}
		if (position === undefined || position === null) {
			position = this.getPos();
		}
		const endRead = position + length;
		if (endRead > this._stat.size) {
			length = this._stat.size - position;
		}
		this._buffer.set(buffer.slice(offset, offset + length), position);
		this._stat.atimeMs = Date.now();
		this._pos = position + length;
		return this._buffer.length;
	}

	/**
	 * Asynchronous `fchmod`.
	 * @param [Number|String] mode
	 */
	public async chmod(mode: number): Promise<void> {
		this.chmodSync(mode);
	}

	/**
	 * Synchronous `fchmod`.
	 * @param [Number] mode
	 */
	public chmodSync(mode: number): void {
		if (!this._fs.metadata.supportsProperties) {
			throw new ApiError(ErrorCode.ENOTSUP);
		}
		this._dirty = true;
		this._stat.chmod(mode);
		this.syncSync();
	}

	/**
	 * Asynchronous `fchown`.
	 * @param [Number] uid
	 * @param [Number] gid
	 */
	public async chown(uid: number, gid: number): Promise<void> {
		this.chownSync(uid, gid);
	}

	/**
	 * Synchronous `fchown`.
	 * @param [Number] uid
	 * @param [Number] gid
	 */
	public chownSync(uid: number, gid: number): void {
		if (!this._fs.metadata.supportsProperties) {
			throw new ApiError(ErrorCode.ENOTSUP);
		}
		this._dirty = true;
		this._stat.chown(uid, gid);
		this.syncSync();
	}

	protected isDirty(): boolean {
		return this._dirty;
	}

	/**
	 * Resets the dirty bit. Should only be called after a sync has completed successfully.
	 */
	protected resetDirty() {
		this._dirty = false;
	}
}

/**
 * File class for the InMemory and XHR file systems.
 * Doesn't sync to anything, so it works nicely for memory-only files.
 */
export class NoSyncFile<T extends FileSystem> extends PreloadFile<T> implements File {
	constructor(_fs: T, _path: string, _flag: FileFlag, _stat: Stats, contents?: Uint8Array) {
		super(_fs, _path, _flag, _stat, contents);
	}
	/**
	 * Asynchronous sync. Doesn't do anything, simply calls the cb.
	 * @param [Function(BrowserFS.ApiError)] cb
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
	 * @param [Function(BrowserFS.ApiError)] cb
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
