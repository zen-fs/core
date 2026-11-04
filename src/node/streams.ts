// SPDX-License-Identifier: LGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-misused-promises */
import type * as fs from 'node:fs';
import type { CreateReadStreamOptions, CreateWriteStreamOptions } from 'node:fs/promises';
import type { Callback } from '../utils.js';
import type { FileHandle } from './promises.js';

import { eos } from '@zenfs/streams/end-of-stream';
import { Readable } from '@zenfs/streams/readable';
import { Writable } from '@zenfs/streams/writable';
import { Errno, Exception, UV } from 'kerium';
import { warn } from 'kerium/log';

export type { ReadStreamOptions, WriteStreamOptions } from 'node:fs';

/**
 * Closes a stream's handle once it has been opened, then calls `callback` with the first error.
 */
function closeHandle(
	stream: { fd: number | null },
	ready: Promise<unknown>,
	handle: () => FileHandle | undefined,
	error: Error | null,
	callback: (error?: Error | null) => void,
): void {
	ready
		.then(() => handle()?.close())
		.then(() => (stream.fd = null))
		.then(
			() => callback(error),
			(closeError: Error) => callback(error ?? closeError),
		);
}

/**
 * Emits `open` and `ready` for a stream that opened its file, which streams created from a descriptor or handle don't.
 */
function emitOpen(stream: ReadStream | WriteStream, fd: number): void {
	stream.emit('open', fd);
	stream.emit('ready');
}

/**
 * A ReadStream implementation that wraps an underlying global ReadableStream.
 */
export class ReadStream extends Readable implements fs.ReadStream {
	public pending = true;
	/** The file descriptor, or `null` before the file is opened and after it is closed */
	public fd: number | null = null;
	private _path = '<unknown>';
	private _bytesRead = 0;
	private reader?: ReadableStreamDefaultReader<Uint8Array>;
	private handle?: FileHandle;
	private ready: Promise<void>;

	public constructor(opts: CreateReadStreamOptions = {}, handleOrPromise: FileHandle | Promise<FileHandle>) {
		super({ ...opts, encoding: opts.encoding ?? undefined, autoDestroy: opts.autoClose ?? true });

		this.ready = Promise.resolve(handleOrPromise)
			.then(handle => {
				this.handle = handle;
				this.fd = handle.fd;
				this._path = handle['vfs'].path;

				// `end` is inclusive for streams, but the internal range is not
				const internal = handle.readableWebStream({
					start: opts.start,
					end: opts.end === undefined ? undefined : opts.end + 1,
					chunkSize: opts.highWaterMark,
				});
				this.reader = internal.getReader();
				this.pending = false;
				if (handleOrPromise instanceof Promise) emitOpen(this, handle.fd);
			})
			.catch(err => {
				this.destroy(err);
			});
	}

	async _read(): Promise<void> {
		try {
			await this.ready;
			if (!this.reader) return;

			const { done, value } = await this.reader.read();
			if (done) {
				this.push(null);
				return;
			}
			this._bytesRead += value.byteLength;
			this.push(value);
		} catch (err: any) {
			this.destroy(new Exception(Errno.EIO, err.toString()));
		}
	}

	_destroy(error: Error | null, callback: (error?: Error | null) => void): void {
		closeHandle(this, this.ready, () => this.handle, error, callback);
	}

	/**
	 * Like Node, the callback is invoked once the stream is closed.
	 * Closing before the stream has finished reports `ERR_STREAM_PREMATURE_CLOSE`.
	 */
	close(callback: Callback<[void]> = () => null): void {
		eos(this, error => callback((error as Exception) ?? null));
		this.destroy();
	}

	public get path(): string {
		return this._path;
	}

	public get bytesRead(): number {
		return this._bytesRead;
	}

	wrap(oldStream: NodeJS.ReadableStream): this {
		super.wrap(oldStream);
		return this;
	}
}

/**
 * A WriteStream implementation that wraps an underlying global WritableStream.
 */
export class WriteStream extends Writable implements fs.WriteStream {
	public pending = true;
	/** The file descriptor, or `null` before the file is opened and after it is closed */
	public fd: number | null = null;
	private _path = '<unknown>';
	private _bytesWritten = 0;
	private writer?: WritableStreamDefaultWriter<Uint8Array>;
	private handle?: FileHandle;
	private ready: Promise<unknown>;

	public constructor(opts: CreateWriteStreamOptions = {}, handleOrPromise: FileHandle | Promise<FileHandle>) {
		super({ ...opts, autoDestroy: opts.autoClose ?? true });

		this.ready = Promise.resolve(handleOrPromise)
			.then(handle => {
				this.handle = handle;
				this.fd = handle.fd;
				this._path = handle['vfs'].path;
				const internal = handle.writableWebStream({ start: opts.start });
				this.writer = internal.getWriter();
				this.pending = false;
				if (handleOrPromise instanceof Promise) emitOpen(this, handle.fd);
			})
			.catch(err => this.destroy(err));
	}

	async _write(chunk: any, encoding: BufferEncoding | 'buffer', callback: (error?: Error | null) => void): Promise<void> {
		await this.ready;

		if (!this.writer) return callback(warn(UV('EAGAIN', 'write', this._path)));
		if (encoding != 'buffer') return callback(warn(UV('ENOTSUP', 'write', this._path)));

		const data = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);

		try {
			await this.writer.write(data);
			this._bytesWritten += chunk.byteLength;
			callback();
		} catch (error: any) {
			callback(new Exception(Errno.EIO, error.toString()));
		}
	}

	async _final(callback: (error?: Error | null) => void): Promise<void> {
		await this.ready;

		if (!this.writer) return callback();

		try {
			await this.writer.close();
			callback();
		} catch (error: any) {
			callback(new Exception(Errno.EIO, error.toString()));
		}
	}

	_destroy(error: Error | null, callback: (error?: Error | null) => void): void {
		closeHandle(this, this.ready, () => this.handle, error, callback);
	}

	/**
	 * Like Node, the stream is ended and the callback is invoked once it is closed.
	 */
	close(callback?: Callback<[void]>): void {
		if (this.closed) {
			callback?.(null);
			return;
		}
		if (callback) this.once('close', () => callback(null));
		if (!this._writableState.autoDestroy) this.once('finish', () => this.destroy());
		this.end();
	}

	public get path(): string {
		return this._path;
	}

	public get bytesWritten(): number {
		return this._bytesWritten;
	}
}
