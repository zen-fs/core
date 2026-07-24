// SPDX-License-Identifier: LGPL-3.0-or-later
import { UV, withErrno } from 'kerium';
import { memoize } from 'utilium';
import * as c from '../constants.js';
import type { V_Context } from '../context.js';
import { contextOf } from '../internal/contexts.js';
import type { FileSystem, StreamOptions } from '../internal/filesystem.js';
import { _chown, InodeFlags, isBlockDevice, isCharacterDevice, type InodeLike } from '../internal/inode.js';
import '../polyfills.js';
import { cacheOf } from './vcache.js';
import type { VNode } from './vnode.js';

/** @hidden */
export interface FileReadResult<T extends ArrayBufferView> {
	bytesRead: number;
	buffer: T;
}

/** The chunk size used when streaming reads and writes */
const streamChunkSize = 0x1000;

/**
 * @internal
 */
export class Handle {
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
		return this.flag & c.O_APPEND ? this.inode.size : this._position;
	}

	public set position(value: number) {
		this._position = value;
	}

	/**
	 * The inode for the file. This is shared between all handles for the file via the vnode.
	 */
	@memoize
	public get inode(): InodeLike {
		return this.vnode.inode;
	}

	@memoize
	public get fs(): FileSystem {
		return this.vnode.fs;
	}

	/**
	 * Whether the file has changes which have not been written to the FS
	 */
	protected get dirty(): boolean {
		return this.vnode.dirty;
	}

	/**
	 * Whether the file is open or closed
	 */
	protected closed: boolean = false;

	public get isClosed(): boolean {
		return this.closed;
	}

	/**
	 * Creates a file handle for the vnode.
	 */
	public constructor(
		public readonly context: V_Context,
		public readonly path: string,
		public readonly internalPath: string,
		public readonly flag: number,
		public readonly vnode: VNode
	) {}

	protected get _isSync(): boolean {
		return !!(this.flag & c.O_SYNC || this.inode.flags! & InodeFlags.Sync || this.fs.attributes.has('sync'));
	}

	public [Symbol.dispose](): void {
		this.closeSync();
	}

	public syncSync(): void {
		if (this.closed) throw UV('EBADF', 'sync', this.path);

		if (!this.dirty) return;

		using _ = this.vnode.lockSync('ro');
		this.vnode.syncSync();
	}

	/**
	 * Default implementation maps to `syncSync`.
	 */
	public datasyncSync(): void {
		return this.syncSync();
	}

	public closeSync(): void {
		if (this.closed) throw UV('EBADF', 'close', this.path);
		this.syncSync();
		this.disposeSync();
	}

	/**
	 * Cleans up. This will *not* sync the file data to the FS
	 */
	protected disposeSync(force?: boolean): void {
		if (this.closed) throw UV('EBADF', 'close', this.path);
		if (this.dirty && !force) throw UV('EBUSY', 'close', this.path);

		this.closed = true;
		cacheOf(this.fs).unref(this.vnode);
	}

	public truncateSync(length: number): void {
		if (length < 0) throw UV('EINVAL', 'truncate', this.path);
		if (this.closed) throw UV('EBADF', 'truncate', this.path);
		if (!(this.flag & c.O_WRONLY || this.flag & c.O_RDWR)) throw UV('EBADF', 'truncate', this.path);
		if (this.fs.attributes.has('readonly')) throw UV('EROFS', 'truncate', this.path);
		if (this.inode.flags! & InodeFlags.Immutable) throw UV('EPERM', 'truncate', this.path);

		using _ = this.vnode.lockSync('rw');
		this.vnode.truncate(length);

		if (this._isSync) this.vnode.syncSync();
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
		if (this.closed) throw UV('EBADF', 'write', this.path);
		if (!(this.flag & c.O_WRONLY || this.flag & c.O_RDWR)) throw UV('EBADF', 'write', this.path);
		if (this.fs.attributes.has('readonly')) throw UV('EROFS', 'write', this.path);
		if (this.inode.flags! & InodeFlags.Immutable) throw UV('EPERM', 'write', this.path);

		using _ = this.vnode.lockSync('rw');

		const slice = buffer.subarray(offset, offset + length);

		this.vnode.writeSync(slice, position);
		this._position = position + slice.byteLength;

		if (this._isSync) this.vnode.syncSync();
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
		if (this.closed) throw UV('EBADF', 'read', this.path);
		if (this.flag & c.O_WRONLY) throw UV('EBADF', 'read', this.path);

		using _ = this.vnode.lockSync('ro');

		if (!(this.inode.flags! & InodeFlags.NoAtime) && !this.fs.attributes.has('no_atime')) {
			this.vnode.metadataDirty = true;
			this.inode.atimeMs = Date.now();
		}

		let end = position + length;
		if (!isCharacterDevice(this.inode) && !isBlockDevice(this.inode) && end > this.inode.size) {
			end = position + Math.max(this.inode.size - position, 0);
		}
		this._position = end;
		const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		this.vnode.readSync(uint8.subarray(offset, offset + length), position, end);
		if (this._isSync) this.vnode.syncSync();
		return end - position;
	}

	public chmodSync(mode: number): void {
		if (this.closed) throw UV('EBADF', 'chmod', this.path);
		using _ = this.vnode.lockSync('rw');
		this.vnode.metadataDirty = true;
		this.inode.mode = (this.inode.mode & (mode > c.S_IFMT ? ~c.S_IFMT : c.S_IFMT)) | mode;
		if (this._isSync || mode > c.S_IFMT) this.vnode.syncSync();
	}

	public chownSync(uid: number, gid: number): void {
		if (this.closed) throw UV('EBADF', 'chmod', this.path);
		using _ = this.vnode.lockSync('rw');
		this.vnode.metadataDirty = true;
		_chown(this.inode, uid, gid);
		if (this._isSync) this.vnode.syncSync();
	}

	/**
	 * Change the file timestamps of the file.
	 */
	public utimesSync(atime: number, mtime: number): void {
		if (this.closed) throw UV('EBADF', 'utimes', this.path);

		using _ = this.vnode.lockSync('rw');
		this.vnode.metadataDirty = true;
		this.inode.atimeMs = atime;
		this.inode.mtimeMs = mtime;
		if (this._isSync) this.vnode.syncSync();
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}

	public async sync(): Promise<void> {
		if (this.closed) throw UV('EBADF', 'sync', this.path);

		if (!this.dirty) return;

		using _ = await this.vnode.lock('ro');
		await this.vnode.sync();
	}

	/**
	 * Default implementation maps to `sync`.
	 */
	public datasync(): Promise<void> {
		return this.sync();
	}

	public async close(): Promise<void> {
		if (this.closed) throw UV('EBADF', 'close', this.path);
		await this.sync();
		this.dispose();
	}

	/**
	 * Cleans up. This will *not* sync the file data to the FS
	 */
	protected dispose(force?: boolean): void {
		if (this.closed) throw UV('EBADF', 'close', this.path);
		if (this.dirty && !force) throw UV('EBUSY', 'close', this.path);

		this.closed = true;
		cacheOf(this.fs).unref(this.vnode);
	}

	public stat(): InodeLike {
		if (this.closed) throw UV('EBADF', 'stat', this.path);

		return this.inode;
	}

	public async truncate(length: number): Promise<void> {
		if (length < 0) throw UV('EINVAL', 'truncate', this.path);
		if (this.closed) throw UV('EBADF', 'truncate', this.path);
		if (!(this.flag & c.O_WRONLY || this.flag & c.O_RDWR)) throw UV('EBADF', 'truncate', this.path);
		if (this.fs.attributes.has('readonly')) throw UV('EROFS', 'truncate', this.path);
		if (this.inode.flags! & InodeFlags.Immutable) throw UV('EPERM', 'truncate', this.path);

		using _ = await this.vnode.lock('rw');
		this.vnode.truncate(length);

		if (this._isSync) await this.vnode.sync();
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
	public async write(
		buffer: Uint8Array,
		offset: number = 0,
		length: number = buffer.byteLength - offset,
		position: number = this.position
	): Promise<number> {
		if (this.closed) throw UV('EBADF', 'write', this.path);
		if (!(this.flag & c.O_WRONLY || this.flag & c.O_RDWR)) throw UV('EBADF', 'write', this.path);
		if (this.fs.attributes.has('readonly')) throw UV('EROFS', 'write', this.path);
		if (this.inode.flags! & InodeFlags.Immutable) throw UV('EPERM', 'write', this.path);

		using _ = await this.vnode.lock('rw');

		const slice = buffer.subarray(offset, offset + length);

		await this.vnode.write(slice, position);
		this._position = position + slice.byteLength;

		if (this._isSync) await this.vnode.sync();
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
	public async read(
		buffer: ArrayBufferView,
		offset: number = 0,
		length: number = buffer.byteLength - offset,
		position: number = this.position
	): Promise<number> {
		if (this.closed) throw UV('EBADF', 'read', this.path);
		if (this.flag & c.O_WRONLY) throw UV('EBADF', 'read', this.path);

		using _ = await this.vnode.lock('ro');

		if (!(this.inode.flags! & InodeFlags.NoAtime) && !this.fs.attributes.has('no_atime')) {
			this.vnode.metadataDirty = true;
			this.inode.atimeMs = Date.now();
		}

		let end = position + length;
		if (!isCharacterDevice(this.inode) && !isBlockDevice(this.inode) && end > this.inode.size) {
			end = position + Math.max(this.inode.size - position, 0);
		}
		this._position = end;
		const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		await this.vnode.read(uint8.subarray(offset, offset + length), position, end);
		if (this._isSync) await this.vnode.sync();
		return end - position;
	}

	public async chmod(mode: number): Promise<void> {
		if (this.closed) throw UV('EBADF', 'chmod', this.path);
		using _ = await this.vnode.lock('rw');
		this.vnode.metadataDirty = true;
		this.inode.mode = (this.inode.mode & (mode > c.S_IFMT ? ~c.S_IFMT : c.S_IFMT)) | mode;
		if (this._isSync || mode > c.S_IFMT) await this.vnode.sync();
	}

	public async chown(uid: number, gid: number): Promise<void> {
		if (this.closed) throw UV('EBADF', 'chown', this.path);
		using _ = await this.vnode.lock('rw');
		this.vnode.metadataDirty = true;
		_chown(this.inode, uid, gid);
		if (this._isSync) await this.vnode.sync();
	}

	/**
	 * Change the file timestamps of the file.
	 */
	public async utimes(atime: number, mtime: number): Promise<void> {
		if (this.closed) throw UV('EBADF', 'utimes', this.path);

		using _ = await this.vnode.lock('rw');
		this.vnode.metadataDirty = true;
		this.inode.atimeMs = atime;
		this.inode.mtimeMs = mtime;
		if (this._isSync) await this.vnode.sync();
	}

	/**
	 * Create a stream for reading the file.
	 * @todo Don't repeat ourselves with the implementation in `FileSystem`
	 */
	public streamRead(options: StreamOptions): ReadableStream {
		if (this.closed) throw UV('EBADF', 'streamRead', this.path);

		const { vnode } = this;
		return new ReadableStream({
			async start(controller) {
				using _ = await vnode.lock('ro');
				const { start = 0, end = vnode.inode.size } = options;

				for (let offset = start; offset < end; offset += streamChunkSize) {
					const bytesRead = offset + streamChunkSize > end ? end - offset : streamChunkSize;
					const buffer = new Uint8Array(bytesRead);
					await vnode.read(buffer, offset, offset + bytesRead).catch(controller.error.bind(controller));
					controller.enqueue(buffer);
				}

				controller.close();
			},
			type: 'bytes',
		});
	}

	/**
	 * Create a stream for writing the file.
	 * Chunks are written to the vnode's cache, then synced when the stream is closed.
	 * @todo Don't repeat ourselves with the implementation in `FileSystem`
	 */
	public streamWrite(options: StreamOptions): WritableStream {
		if (this.closed) throw UV('EBADF', 'write', this.path);
		if (this.inode.flags! & InodeFlags.Immutable) throw UV('EPERM', 'write', this.path);
		if (this.fs.attributes.has('readonly')) throw UV('EROFS', 'write', this.path);

		const { vnode } = this;
		let position = options.start ?? 0;
		return new WritableStream<Uint8Array>({
			async write(chunk, controller) {
				using _ = await vnode.lock('rw');
				await vnode.write(chunk, position).catch(controller.error.bind(controller));
				position += chunk.byteLength;
			},
			async close() {
				using _ = await vnode.lock('ro');
				await vnode.sync();
			},
		});
	}
}

// descriptors

/**
 * @internal @hidden
 */
export function toFD(file: Handle): number {
	const map = contextOf(file.context).descriptors;
	const fd = Math.max(map.size ? Math.max(...map.keys()) + 1 : 0, 4);
	map.set(fd, file);
	return fd;
}

/**
 * @internal @hidden
 */
export function fromFD($: V_Context, fd: number): Handle {
	const map = contextOf($).descriptors;
	const value = map.get(fd);
	if (!value) throw withErrno('EBADF');
	return value;
}

export function deleteFD($: V_Context, fd: number): boolean {
	return contextOf($).descriptors.delete(fd);
}
