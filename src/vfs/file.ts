import type { V_Context } from '../context.js';
import { Errno, ErrnoError } from '../internal/error.js';
import type { FileSystem, StreamOptions } from '../internal/filesystem.js';
import { InodeFlags, isBlockDevice, isCharacterDevice, type InodeLike } from '../internal/inode.js';
import '../polyfills.js';
import { config } from './config.js';
import * as c from './constants.js';
import { _chown } from './stats.js';

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
 * @internal
 */
export class SyncHandle {
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
		public readonly context: V_Context,
		public readonly path: string,
		public readonly fs: FileSystem,
		public readonly internalPath: string,
		public readonly flag: string,
		public readonly stats: InodeLike
	) {}

	public [Symbol.dispose](): void {
		this.closeSync();
	}

	public syncSync(): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'sync');

		if (!this.dirty) return;

		if (!this.fs.attributes.has('no_write')) this.fs.syncSync(this.internalPath, undefined, this.stats);
		this.dirty = false;
	}

	/**
	 * Default implementation maps to `syncSync`.
	 */
	public datasyncSync(): void {
		return this.syncSync();
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

	public statSync(): InodeLike {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'stat');

		return this.stats;
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
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'write');

		if (!isWriteable(this.flag)) throw new ErrnoError(Errno.EPERM, 'File not opened with a writeable mode');

		if (this.stats.flags! & InodeFlags.Immutable) throw new ErrnoError(Errno.EPERM, 'File is immutable', this.path, 'write');

		this.dirty = true;
		const end = position + length;
		const slice = buffer.subarray(offset, offset + length);

		if (!isCharacterDevice(this.stats) && !isBlockDevice(this.stats) && end > this.stats.size) this.stats.size = end;

		this.stats.mtimeMs = Date.now();
		this._position = position + slice.byteLength;
		this.fs.writeSync(this.internalPath, slice, position);
		if (config.syncImmediately) this.syncSync();
		return slice.byteLength;
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
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'read');

		if (!isReadable(this.flag)) throw new ErrnoError(Errno.EPERM, 'File not opened with a readable mode');

		if (config.updateOnRead) this.dirty = true;

		this.stats.atimeMs = Date.now();

		let end = position + length;
		if (!isCharacterDevice(this.stats) && !isBlockDevice(this.stats) && end > this.stats.size) {
			end = position + Math.max(this.stats.size - position, 0);
		}
		this._position = end;
		const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		this.fs.readSync(this.internalPath, uint8.subarray(offset, offset + length), position, end);
		if (config.syncImmediately) this.syncSync();
		return end - position;
	}

	public chmodSync(mode: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chmod');
		this.dirty = true;
		this.stats.mode = (this.stats.mode & (mode > c.S_IFMT ? ~c.S_IFMT : c.S_IFMT)) | mode;
		if (config.syncImmediately || mode > c.S_IFMT) this.syncSync();
	}

	public chownSync(uid: number, gid: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'chown');
		this.dirty = true;
		_chown(this.stats, uid, gid);
		if (config.syncImmediately) this.syncSync();
	}

	/**
	 * Change the file timestamps of the file.
	 */
	public utimesSync(atime: number, mtime: number): void {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'utimes');

		this.dirty = true;
		this.stats.atimeMs = atime;
		this.stats.mtimeMs = mtime;
		if (config.syncImmediately) this.syncSync();
	}

	/**
	 * Create a stream for reading the file.
	 */
	public streamRead(options: StreamOptions): ReadableStream {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'streamRead');

		return this.fs.streamRead(this.internalPath, options);
	}

	/**
	 * Create a stream for writing the file.
	 */
	public streamWrite(options: StreamOptions): WritableStream {
		if (this.closed) throw ErrnoError.With('EBADF', this.path, 'streamWrite');
		if (this.stats.flags! & InodeFlags.Immutable) throw new ErrnoError(Errno.EPERM, 'File is immutable', this.path, 'streamWrite');
		return this.fs.streamWrite(this.internalPath, options);
	}
}

// descriptors

/**
 * A map of FDs that are not bound to a context.
 * @internal @hidden
 */
const fdMap = new Map<number, SyncHandle>();

/**
 * @internal @hidden
 */
export function toFD(file: SyncHandle): number {
	const map = file.context?.descriptors ?? fdMap;
	const fd = map.size ? Math.max(...map.keys()) + 1 : 0;
	map.set(fd, file);
	return fd;
}

/**
 * @internal @hidden
 */
export function fromFD($: V_Context, fd: number): SyncHandle {
	const map = $?.descriptors ?? fdMap;
	const value = map.get(fd);
	if (!value) throw new ErrnoError(Errno.EBADF);
	return value;
}

export function deleteFD($: V_Context, fd: number): boolean {
	return ($?.descriptors ?? fdMap).delete(fd);
}
