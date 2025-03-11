import type { Dir as _Dir, Dirent as _Dirent } from 'node:fs';
import type { V_Context } from '../context.js';
import { isBlockDevice, isCharacterDevice, isDirectory, isFIFO, isFile, isSocket, isSymbolicLink, type InodeLike } from '../internal/inode.js';
import type { Callback } from '../utils.js';

import { Errno, ErrnoError } from '../internal/error.js';
import { basename } from '../path.js';
import { readdir } from './promises.js';
import { readdirSync } from './sync.js';

export class Dirent implements _Dirent {
	public get name(): string {
		return basename(this.path);
	}

	public constructor(
		public path: string,
		protected stats: InodeLike
	) {}

	get parentPath(): string {
		return this.path;
	}

	isFile(): boolean {
		return isFile(this.stats);
	}
	isDirectory(): boolean {
		return isDirectory(this.stats);
	}
	isBlockDevice(): boolean {
		return isBlockDevice(this.stats);
	}
	isCharacterDevice(): boolean {
		return isCharacterDevice(this.stats);
	}
	isSymbolicLink(): boolean {
		return isSymbolicLink(this.stats);
	}
	isFIFO(): boolean {
		return isFIFO(this.stats);
	}
	isSocket(): boolean {
		return isSocket(this.stats);
	}
}

/**
 * A class representing a directory stream.
 */
export class Dir implements _Dir, AsyncIterator<Dirent> {
	protected closed = false;

	protected checkClosed(): void {
		if (this.closed) {
			throw new ErrnoError(Errno.EBADF, 'Can not use closed Dir');
		}
	}

	protected _entries?: Dirent[];

	public constructor(
		public readonly path: string,
		protected readonly context: V_Context
	) {}

	/**
	 * Asynchronously close the directory's underlying resource handle.
	 * Subsequent reads will result in errors.
	 */
	public close(): Promise<void>;
	public close(cb: Callback): void;
	public close(cb?: Callback): void | Promise<void> {
		this.closed = true;
		if (!cb) {
			return Promise.resolve();
		}
		cb();
	}

	/**
	 * Synchronously close the directory's underlying resource handle.
	 * Subsequent reads will result in errors.
	 */
	public closeSync(): void {
		this.closed = true;
	}

	protected async _read(): Promise<Dirent | null> {
		this.checkClosed();
		this._entries ??= await readdir.call<V_Context, [string, any], Promise<Dirent[]>>(this.context, this.path, {
			withFileTypes: true,
		});
		if (!this._entries.length) return null;
		return this._entries.shift() ?? null;
	}

	/**
	 * Asynchronously read the next directory entry via `readdir(3)` as an `Dirent`.
	 * After the read is completed, a value is returned that will be resolved with an `Dirent`, or `null` if there are no more directory entries to read.
	 * Directory entries returned by this function are in no particular order as provided by the operating system's underlying directory mechanisms.
	 */
	public read(): Promise<Dirent | null>;
	public read(cb: Callback<[Dirent | null]>): void;
	public read(cb?: Callback<[Dirent | null]>): void | Promise<Dirent | null> {
		if (!cb) {
			return this._read();
		}

		void this._read().then(value => cb(undefined, value));
	}

	/**
	 * Synchronously read the next directory entry via `readdir(3)` as a `Dirent`.
	 * If there are no more directory entries to read, null will be returned.
	 * Directory entries returned by this function are in no particular order as provided by the operating system's underlying directory mechanisms.
	 */
	public readSync(): Dirent | null {
		this.checkClosed();
		this._entries ??= readdirSync.call<V_Context, [string, any], Dirent[]>(this.context, this.path, { withFileTypes: true });
		if (!this._entries.length) return null;
		return this._entries.shift() ?? null;
	}

	async next(): Promise<IteratorResult<Dirent>> {
		const value = await this._read();
		if (value) {
			return { done: false, value };
		}

		await this.close();
		return { done: true, value: undefined };
	}

	/**
	 * Asynchronously iterates over the directory via `readdir(3)` until all entries have been read.
	 */
	public [Symbol.asyncIterator](): this {
		return this;
	}

	public [Symbol.asyncDispose]() {
		return Promise.resolve();
	}
}
