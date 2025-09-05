// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Dir as _Dir, Dirent as _Dirent } from 'node:fs';
import type { V_Context } from '../internal/contexts.js';
import type { InodeLike } from '../internal/inode.js';
import type { Callback } from '../utils.js';

import { Buffer } from 'buffer';
import { withErrno } from 'kerium';
import { warn } from 'kerium/log';
import { sizeof } from 'memium';
import { $from, struct, types as t } from 'memium/decorators';
import { encodeUTF8 } from 'utilium';
import { BufferView } from 'utilium/buffer.js';
import { basename, dirname } from '../path.js';
import { readdir } from './promises.js';
import { readdirSync } from './sync.js';

/**
 * @see `DT_*` in `dirent.h`
 */
export enum DirType {
	UNKNOWN = 0,
	FIFO = 1,
	CHR = 2,
	DIR = 4,
	BLK = 6,
	REG = 8,
	LNK = 10,
	SOCK = 12,
	WHT = 14,
}

/**
 * Converts a file mode to a directory type.
 * @see `IFTODT` in `dirent.h`
 */
export function ifToDt(mode: number): DirType {
	return ((mode & 0o170000) >> 12) as DirType;
}

/**
 * Converts a directory type to a file mode.
 * @see `DTTOIF` in `dirent.h`
 */
export function dtToIf(dt: DirType): number {
	return dt << 12;
}

@struct.packed('Dirent')
export class Dirent<Name extends string | Buffer = string, TArrayBuffer extends ArrayBufferLike = ArrayBufferLike>
	extends $from(BufferView)<TArrayBuffer>
	implements _Dirent<Name>
{
	@t.uint32 protected accessor ino!: number;

	/** Reserved for 64-bit inodes */
	@t.uint32 private accessor _ino!: number;

	@t.uint8 protected accessor type!: DirType;

	@t.char(256)
	protected accessor _name!: Uint8Array;

	public get name(): Name {
		const end = (this._name.indexOf(0) + 1 || 256) - 1;
		const name = Buffer.from(this._name.subarray(0, end));
		return (this._encoding == 'buffer' ? name : name.toString(this._encoding!)) as Name;
	}

	/**
	 * @internal @protected
	 */
	_encoding?: BufferEncoding | 'buffer' | null;

	/**
	 * @internal @protected
	 */
	_parentPath!: string;

	get parentPath(): string {
		return this._parentPath;
	}

	/**
	 * @deprecated Removed in Node v24, use `parentPath` instead.
	 */
	get path(): string {
		warn('Dirent.path was removed in Node v24, use parentPath instead');
		return this._parentPath;
	}

	/**
	 * @internal
	 */
	static from(path: string, stats: InodeLike, encoding?: BufferEncoding | 'buffer' | null): Dirent {
		const dirent = new Dirent(new ArrayBuffer(sizeof(Dirent) + 1));
		dirent._parentPath = dirname(path);
		dirent._name = encodeUTF8(basename(path));
		dirent.ino = stats.ino;
		dirent.type = ifToDt(stats.mode);
		dirent._encoding = encoding;
		return dirent;
	}

	isFile(): boolean {
		return this.type === DirType.REG;
	}
	isDirectory(): boolean {
		return this.type === DirType.DIR;
	}
	isBlockDevice(): boolean {
		return this.type === DirType.BLK;
	}
	isCharacterDevice(): boolean {
		return this.type === DirType.CHR;
	}
	isSymbolicLink(): boolean {
		return this.type === DirType.LNK;
	}
	isFIFO(): boolean {
		return this.type === DirType.FIFO;
	}
	isSocket(): boolean {
		return this.type === DirType.SOCK;
	}
}

/**
 * A class representing a directory stream.
 */
export class Dir implements _Dir, AsyncIterator<Dirent> {
	protected closed = false;

	protected checkClosed(): void {
		if (this.closed) throw withErrno('EBADF', 'Can not use closed Dir');
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
		cb(null);
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

		void this._read().then(value => cb(null, value));
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

	[Symbol.dispose](): void {
		if (this.closed) return;
		this.closeSync();
	}

	public async [Symbol.asyncDispose]() {
		if (this.closed) return;
		await this.close();
	}
}
