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
import { validateType } from './utils.js';

export type { ReadStreamOptions, WriteStreamOptions } from 'node:fs';

type OperationCallback<T = void> = (error: Error | null, result: T) => void;

/** The file system operations a stream's `fs` option can provide */
export interface StreamOperations {
	open?: (path: fs.PathLike, flags: fs.OpenMode, mode: fs.Mode, callback: OperationCallback<number>) => void;
	read?: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: OperationCallback<number>) => void;
	write?: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, callback: OperationCallback<number>) => void;
	writev?: (fd: number, buffers: Uint8Array[], position: number | null, callback: OperationCallback<number>) => void;
	close?: (fd: number, callback: OperationCallback) => void;
}

/** The default size of the chunks read by streams using `fs` operations, in bytes */
const operationsChunkSize = 64 * 1024;

/**
 * Calls a callback-based operation, resolving with its result.
 */
function callOperation<T>(run: (callback: OperationCallback<T>) => void): Promise<T> {
	const { promise, resolve, reject } = Promise.withResolvers<T>();
	run((error, result) => (error ? reject(error) : resolve(result)));
	return promise;
}

/**
 * A file opened through a stream's `fs` operations, providing what a stream needs from a `FileHandle`.
 */
export class OperationsHandle {
	public constructor(
		protected readonly operations: StreamOperations,
		public readonly fd: number,
		public readonly path: string,
	) {}

	/**
	 * Opens `path` with the `open` operation, unless `fd` is given.
	 */
	public static open(
		operations: StreamOperations,
		path: fs.PathLike,
		fd: unknown,
		flags: fs.OpenMode,
		mode: fs.Mode,
	): OperationsHandle | Promise<OperationsHandle> {
		if (typeof fd == 'number') return new OperationsHandle(operations, fd, path?.toString() ?? '');
		if (fd != null) throw Object.assign(new Error('The FileHandle with fs method is not implemented'), { code: 'ERR_METHOD_NOT_IMPLEMENTED' });
		return callOperation<number>(callback => operations.open!(path, flags, mode, callback)).then(
			fd => new OperationsHandle(operations, fd, path.toString()),
		);
	}

	public readableWebStream({
		start,
		end,
		chunkSize = operationsChunkSize,
	}: {
		start?: number;
		end?: number;
		chunkSize?: number;
	}): ReadableStream<Uint8Array> {
		const { operations, fd } = this;
		let position = start;
		let remaining = end === undefined ? Infinity : end - (start ?? 0);

		return new ReadableStream({
			async pull(controller) {
				const size = Math.min(chunkSize, remaining);
				const buffer = new Uint8Array(Math.max(size, 0));
				const bytesRead =
					size > 0 ? await callOperation<number>(callback => operations.read!(fd, buffer, 0, size, position ?? null, callback)) : 0;

				if (!bytesRead) {
					controller.close();
					return;
				}

				if (position !== undefined) position += bytesRead;
				remaining -= bytesRead;
				controller.enqueue(buffer.subarray(0, bytesRead));
			},
		});
	}

	public writableWebStream({ start }: { start?: number }): WritableStream<Uint8Array> {
		const { operations, fd } = this;
		let position = start;

		const write = (chunk: Uint8Array) =>
			callOperation<number>(callback =>
				operations.write
					? operations.write(fd, chunk, 0, chunk.byteLength, position ?? null, callback)
					: operations.writev!(fd, [chunk], position ?? null, callback),
			);

		return new WritableStream({
			async write(chunk) {
				const bytesWritten = await write(chunk);
				if (position !== undefined) position += bytesWritten;
			},
		});
	}

	public async close(): Promise<void> {
		if (this.operations.close) await callOperation(callback => this.operations.close!(this.fd, callback));
	}
}

/**
 * Throws Node's errors for a stream's `fs` option that is missing an operation the stream needs.
 */
export function validateOperations(operations: StreamOperations, kind: 'read' | 'write', options: { fd?: unknown; autoClose?: boolean }): void {
	if (options.fd == null) validateType(operations.open, 'options.fs.open', 'function');
	if (kind == 'read') validateType(operations.read, 'options.fs.read', 'function');
	else if (!operations.write && !operations.writev) validateType(operations.write, 'options.fs.write', 'function');
	else {
		if (operations.write) validateType(operations.write, 'options.fs.write', 'function');
		if (operations.writev) validateType(operations.writev, 'options.fs.writev', 'function');
	}
	if (options.autoClose ?? true) validateType(operations.close, 'options.fs.close', 'function');
}

/**
 * Closes a stream's handle once it has been opened, then calls `callback` with the first error.
 */
function closeHandle(
	stream: { fd: number | null },
	ready: Promise<unknown>,
	handle: () => FileHandle | OperationsHandle | undefined,
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
	private handle?: FileHandle | OperationsHandle;
	private ready: Promise<void>;

	public constructor(opts: CreateReadStreamOptions = {}, handleOrPromise: FileHandle | OperationsHandle | Promise<FileHandle | OperationsHandle>) {
		super({ ...opts, encoding: opts.encoding ?? undefined, autoDestroy: opts.autoClose ?? true });

		this.ready = Promise.resolve(handleOrPromise)
			.then(handle => {
				this.handle = handle;
				this.fd = handle.fd;
				this._path = handle instanceof OperationsHandle ? handle.path : handle['vfs'].path;

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
	private handle?: FileHandle | OperationsHandle;
	private ready: Promise<unknown>;

	public constructor(opts: CreateWriteStreamOptions = {}, handleOrPromise: FileHandle | OperationsHandle | Promise<FileHandle | OperationsHandle>) {
		super({ ...opts, autoDestroy: opts.autoClose ?? true });

		this.ready = Promise.resolve(handleOrPromise)
			.then(handle => {
				this.handle = handle;
				this.fd = handle.fd;
				this._path = handle instanceof OperationsHandle ? handle.path : handle['vfs'].path;
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
