/* eslint-disable @typescript-eslint/no-misused-promises */
import type { Abortable } from 'node:events';
import type * as fs from 'node:fs';
import type { CreateReadStreamOptions, CreateWriteStreamOptions } from 'node:fs/promises';
import type { Callback } from '../utils.js';
import type { FileHandle } from './promises.js';

import { Readable, Writable } from 'readable-stream';
import { Errno, ErrnoError } from '../internal/error.js';
import { warn } from '../internal/log.js';

interface FSImplementation {
	open?: (...args: unknown[]) => unknown;
	close?: (...args: unknown[]) => unknown;
}

interface StreamOptions extends Abortable {
	flags?: string;
	encoding?: BufferEncoding;
	fd?: number | FileHandle;
	mode?: number;
	autoClose?: boolean;
	emitClose?: boolean;
	start?: number;
	highWaterMark?: number;
}

/**
 * This type is from node:fs but not exported.
 * @hidden
 */
export interface ReadStreamOptions extends StreamOptions {
	fs?: FSImplementation & { read: (...args: unknown[]) => unknown };
	end?: number;
}

/**
 * This type is from node:fs but not exported.
 * @hidden
 */
export interface WriteStreamOptions extends StreamOptions {
	flush?: boolean;
	fs?: FSImplementation & {
		write: (...args: unknown[]) => unknown;
		writev?: (...args: unknown[]) => unknown;
	};
}

export class ReadStream extends Readable implements fs.ReadStream {
	protected start?: number;
	protected handle?: FileHandle;
	protected position?: number;
	public pending: boolean = true;

	public constructor(
		private opts: CreateReadStreamOptions = {},
		_handle: FileHandle | Promise<FileHandle>
	) {
		super({
			...opts,
			read: async (size: number) => {
				try {
					this.handle ||= await _handle;
					this.start ??= this.handle.file.position;
					this.position ??= this.start;

					if (typeof opts.end === 'number' && this.position >= opts.end) {
						this.push(null);
						if (opts.autoClose) await this.handle.close();
						return;
					}

					if (typeof opts.end === 'number') {
						size = Math.min(size, opts.end - this.position);
					}

					console.log(`ReadStream: ${size} bytes at ${this.position}`);

					const result = await this.handle.file.read(new Uint8Array(size), 0, size, this.position);
					this.push(!result.bytesRead ? null : result.buffer.subarray(0, result.bytesRead));
					if (!result.bytesRead && opts.autoClose) await this.handle.close();
					this.position += result.bytesRead;
				} catch (error: any) {
					if (opts.autoClose) await this.handle?.close().catch(e => warn('Error whilst closing handle for stream: ' + e));
					this.destroy(error);
				}
			},
			highWaterMark: opts.highWaterMark || 0x1000,
			encoding: opts.encoding ?? undefined,
		});

		if (_handle instanceof Promise) void _handle.then(() => (this.pending = false));
		else this.pending = false;

		this.start = opts.start;
		this.position = opts.start;
	}

	close = (callback: Callback<[void], null> = () => null) => {
		try {
			super.destroy();
			super.emit('close');
			callback(null);
		} catch (err) {
			callback(new ErrnoError(Errno.EIO, (err as Error).toString()));
		}
	};

	wrap(oldStream: NodeJS.ReadableStream): this {
		super.wrap(oldStream as any);
		return this;
	}

	public get path(): string {
		return this.handle?.file.path ?? '<unknown>';
	}

	public get bytesRead(): number {
		return (this.position ?? 0) - (this.start ?? 0);
	}
}

export class WriteStream extends Writable implements fs.WriteStream {
	protected start?: number;
	protected handle?: FileHandle;
	protected position?: number;
	public pending: boolean = true;

	public constructor(
		private opts: CreateWriteStreamOptions = {},
		_handle: FileHandle | Promise<FileHandle>
	) {
		const { stack } = new Error();

		super({
			...opts,
			highWaterMark: opts.highWaterMark || 0x1000,
			write: async (chunk: Uint8Array, encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
				try {
					this.handle ||= await _handle;
					this.start ??= this.handle.file.position;
					this.position ??= this.start;

					const { bytesWritten } = await this.handle.write(chunk, null, encoding, this.position);
					if (bytesWritten != chunk.length)
						throw new ErrnoError(Errno.EIO, `Failed to write full chunk of write stream (wrote ${bytesWritten}/${chunk.length} bytes)`);
					this.position += bytesWritten;
					callback();
				} catch (error: any) {
					if (opts.autoClose) await this.handle?.close();
					error.stack += stack?.slice(5);
					callback(error);
				}
			},
			destroy: async (error, callback) => {
				if (opts.autoClose) await this.handle?.close().catch(callback);
				callback(error);
			},
			final: async callback => {
				if (opts.autoClose) await this.handle?.close().catch(() => {});
				callback();
			},
		});

		if (_handle instanceof Promise) void _handle.then(() => (this.pending = false));
		else this.pending = false;

		this.start = opts.start;
		this.position = opts.start;
	}

	close = (callback: Callback<[void], null> = () => null) => {
		try {
			super.destroy();
			super.emit('close');
			callback(null);
		} catch (err) {
			callback(new ErrnoError(Errno.EIO, (err as Error).toString()));
		}
	};

	public get path(): string {
		return this.handle?.file.path ?? '<unknown>';
	}

	public get bytesWritten(): number {
		return (this.position ?? 0) - (this.start ?? 0);
	}
}
