/* eslint-disable @typescript-eslint/triple-slash-reference, @typescript-eslint/no-misused-promises */
/// <reference path="../../types/readable-stream.d.ts" preserve="true" />
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

/**
 * A ReadStream implementation that wraps an underlying global ReadableStream.
 */
export class ReadStream extends Readable implements fs.ReadStream {
	public pending = true;
	private _path = '<unknown>';
	private _bytesRead = 0;
	private reader?: ReadableStreamDefaultReader<Uint8Array>;

	public constructor(opts: CreateReadStreamOptions = {}, handleOrPromise: FileHandle | Promise<FileHandle>) {
		super({ ...opts, encoding: opts.encoding ?? undefined });

		Promise.resolve(handleOrPromise)
			.then(handle => {
				this._path = handle.path;

				const internal = handle.fs.streamRead(handle.path, { start: opts.start, end: opts.end });
				this.reader = internal.getReader();
				this.pending = false;
				return this._read();
			})
			.catch(err => this.destroy(err));
	}

	async _read(): Promise<void> {
		if (!this.reader) return;

		const { done, value } = await this.reader.read();

		if (done) {
			this.push(null);
			return;
		}

		this._bytesRead += value.byteLength;
		if (!this.push(value)) return;

		await this._read();
	}

	close(callback: Callback<[void], null> = () => null): void {
		try {
			this.destroy();
			this.emit('close');
			callback(null);
		} catch (err: any) {
			callback(new ErrnoError(Errno.EIO, err.toString()));
		}
	}

	public get path(): string {
		return this._path;
	}

	public get bytesRead(): number {
		return this._bytesRead;
	}

	wrap(oldStream: NodeJS.ReadableStream): this {
		super.wrap(oldStream as any);
		return this;
	}
}

/**
 * A WriteStream implementation that wraps an underlying global WritableStream.
 */
export class WriteStream extends Writable implements fs.WriteStream {
	public pending = true;
	private _path = '<unknown>';
	private _bytesWritten = 0;
	private writer?: WritableStreamDefaultWriter<Uint8Array>;
	private ready: Promise<unknown>;

	public constructor(opts: CreateWriteStreamOptions = {}, handleOrPromise: FileHandle | Promise<FileHandle>) {
		super(opts);

		this.ready = Promise.resolve(handleOrPromise)
			.then(handle => {
				this._path = handle.path;
				const internal = handle.fs.streamWrite(handle.path, { start: opts.start });
				this.writer = internal.getWriter();
				this.pending = false;
			})
			.catch(err => this.destroy(err));
	}

	async _write(chunk: any, encoding: BufferEncoding | 'buffer', callback: (error?: Error | null) => void): Promise<void> {
		await this.ready;

		if (!this.writer) return callback(warn(new ErrnoError(Errno.EAGAIN, 'Underlying writable stream not ready', this._path)));
		if (encoding != 'buffer') return callback(warn(new ErrnoError(Errno.ENOTSUP, 'Unsupported encoding for stream', this._path)));

		const data = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);

		try {
			await this.writer.write(data);
			this._bytesWritten += chunk.byteLength;
			callback();
		} catch (error: any) {
			callback(new ErrnoError(Errno.EIO, error.toString()));
		}
	}

	async _final(callback: (error?: Error | null) => void): Promise<void> {
		await this.ready;

		if (!this.writer) return callback();

		try {
			await this.writer.close();
			callback();
		} catch (error: any) {
			callback(new ErrnoError(Errno.EIO, error.toString()));
		}
	}

	close(callback: Callback<[void], null> = () => null): void {
		try {
			this.destroy();
			this.emit('close');
			callback(null);
		} catch (error: any) {
			callback(new ErrnoError(Errno.EIO, error.toString()));
		}
	}

	public get path(): string {
		return this._path;
	}

	public get bytesWritten(): number {
		return this._bytesWritten;
	}
}
