// SPDX-License-Identifier: LGPL-3.0-or-later
import { Buffer } from 'buffer';
import { EventEmitter } from 'eventemitter3';
import { UV } from 'kerium';
import type { EventEmitter as NodeEventEmitter } from 'node:events';
import type * as fs from 'node:fs';
import { bindFunctions } from 'utilium';
import { assertContext, type FSContext } from '../internal/contexts.js';
import { dirname } from '../path.js';
import { close, fsync, mkdir, open, write } from './async.js';
import { fsyncSync, mkdirSync, openSync, writeSync } from './sync.js';

/* Everything below is a port of Node's `internal/fs/utf8stream`,
which is itself derived from the SonicBoom module (https://github.com/pinojs/sonic-boom).
MIT License, Copyright (c) 2017 Matteo Collina */

/** An error with a Node-style `code`, e.g. `ERR_INVALID_STATE` @hidden */
function error(code: string, message: string): Error {
	return Object.assign(new Error(message), { code });
}

/** @hidden */
function invalidArgType(name: string, expected: string, value: unknown): Error {
	return error('ERR_INVALID_ARG_TYPE', `The "${name}" argument must be of type ${expected}. Received ${typeof value}`);
}

/** @hidden */
function invalidState(message: string): Error {
	return error('ERR_INVALID_STATE', 'Invalid state: ' + message);
}

/** @hidden */
function validateUint32(value: number, name: string): void {
	if (typeof value != 'number') throw invalidArgType(name, 'number', value);
	if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
		throw error('ERR_OUT_OF_RANGE', `The value of "${name}" is out of range. It must be an integer >= 0 and <= 4294967295. Received ${value}`);
}

/** 16 KB. Don't write more than the docker buffer size. */
const maxWriteDefault = 16 * 1024;

/** How long to wait before retrying a write that failed with `EAGAIN` or `EBUSY` */
const busyWriteTimeout = 100;

const emptyBuffer = Buffer.alloc(0);

interface FS {
	open(path: string, flags: string, mode: fs.Mode, cb: (err: Error | null, fd: number) => void): void;
	openSync(path: string, flags: string, mode: fs.Mode): number;
	close(fd: number, cb: (err: Error | null) => void): void;
	write(fd: number, data: Buffer, cb: (err: Error | null, n: number) => void): void;
	write(fd: number, data: string, encoding: BufferEncoding, cb: (err: Error | null, n: number) => void): void;
	writeSync(fd: number, data: Buffer): number;
	writeSync(fd: number, data: string, encoding: BufferEncoding): number;
	fsync(fd: number, cb: (err: Error | null) => void): void;
	fsyncSync(fd: number): void;
	mkdir(path: string, options: { recursive: true }, cb: (err: Error | null) => void): void;
	mkdirSync(path: string, options: { recursive: true }): void;
}

const _utf8StreamFS = { open, openSync, close, write, writeSync, fsync, fsyncSync, mkdir, mkdirSync } as unknown as FS;

/**
 * Release `writingBuf` after `n` bytes of it have been written.
 * @hidden
 */
function _release<T extends string | Buffer>(writingBuf: T, len: number, n: number): { writingBuf: T; len: number } {
	if (typeof writingBuf == 'string') {
		const byteLength = Buffer.byteLength(writingBuf);
		/*
			`write` returns the number of bytes written, but `len` is tracked in characters
			and `writingBuf` is sliced by character index below,
			so `n` must be converted from bytes to characters in both cases.
		*/
		if (byteLength === n) {
			// The whole string was written: advance past every character.
			n = writingBuf.length;
		} else {
			/*
				A partial write may split a multi-byte UTF-8 character, so we must back up to the start of that character.
				Continuation bytes have the pattern 10xxxxxx (0x80-0xbf).
			*/
			const buf = Buffer.from(writingBuf);
			while (n > 0 && (buf[n] & 0xc0) === 0x80) n--;
			// Decode the properly-aligned bytes to get the character count.
			n = buf.subarray(0, n).toString().length;
		}
	}

	return { writingBuf: writingBuf.slice(n) as T, len: Math.max(len - n, 0) };
}

/** @hidden */
function _mergeBuffers(bufs: Buffer[], len: number): Buffer {
	if (!bufs.length) return emptyBuffer;
	if (bufs.length == 1) return bufs[0];
	return Buffer.concat(bufs, len);
}

const kUtf8StreamFS = Symbol('Utf8StreamFS');

/**
 * An optimized UTF-8 stream writer that allows for flushing all of the internal buffering on demand.
 */
export class Utf8Stream extends EventEmitter<fs.Utf8StreamEventMap> implements NodeEventEmitter, fs.Utf8Stream {
	#len = 0;
	#fd = -1;
	/** Pending chunks. Strings when `contentMode` is `utf8`, groups of buffers when it is `buffer`. */
	#bufs: (string | Buffer[])[] = [];
	/** The byte length of each group in `#bufs`. Only used when `contentMode` is `buffer`. */
	#lens: number[] = [];
	#writing = false;
	#ending = false;
	#reopening = false;
	#asyncDrainScheduled = false;
	#flushPending = false;
	/** 16 KB */
	#hwm = 16387;
	#file: string | null = null;
	#destroyed = false;
	#minLength = 0;
	#maxLength = 0;
	#maxWrite = maxWriteDefault;
	#opening = false;
	#periodicFlush = 0;
	#periodicFlushTimer?: ReturnType<typeof setInterval>;
	#sync = false;
	#fsync = false;
	#append = true;
	#mode: fs.Mode;
	#retryEAGAIN: (err: Error, writeBufferLen: number, remainingBufferLen: number) => boolean = () => true;
	#mkdir = false;
	#contentMode: 'utf8' | 'buffer';
	#writingBuf: string | Buffer = '';
	#fs: FS;

	declare ['constructor']: typeof Utf8Stream;
	static [kUtf8StreamFS]: FS = _utf8StreamFS;

	/** @hidden @internal */
	static _withContext(ctx: FSContext): typeof Utf8Stream {
		assertContext(ctx);

		class $Utf8Stream extends Utf8Stream {
			static [kUtf8StreamFS] = bindFunctions(_utf8StreamFS, ctx);
		}
		return $Utf8Stream;
	}

	public constructor(options: fs.Utf8StreamOptions = {}) {
		if (typeof options != 'object' || options === null) throw invalidArgType('options', 'object', options);

		const {
			dest,
			minLength,
			maxLength,
			maxWrite,
			periodicFlush,
			sync,
			append = true,
			mkdir,
			retryEAGAIN,
			fsync,
			contentMode = 'utf8',
			mode,
			// Provides for a custom fs implementation. Mostly useful for testing.
			fs: overrideFS = {},
		} = options;

		super();

		const fd = options.fd ?? dest;

		if (typeof overrideFS != 'object' || overrideFS === null) throw invalidArgType('options.fs', 'object', overrideFS);
		this.#fs = { ...this.constructor[kUtf8StreamFS], ...overrideFS };
		const _fs = this.#fs as unknown as Record<string, unknown>;
		for (const key of ['write', 'writeSync', 'fsync', 'fsyncSync', 'close', 'open', 'mkdir', 'mkdirSync']) {
			if (typeof _fs[key] != 'function') throw invalidArgType(`options.fs.${key}`, 'function', _fs[key]);
		}

		this.#hwm = Math.max(minLength || 0, this.#hwm);
		this.#minLength = minLength || 0;
		this.#maxLength = maxLength || 0;
		this.#maxWrite = maxWrite || maxWriteDefault;
		this.#periodicFlush = periodicFlush || 0;
		this.#sync = sync || false;
		this.#fsync = fsync || false;
		this.#append = append || false;
		this.#mode = mode!;
		this.#retryEAGAIN = retryEAGAIN || (() => true);
		this.#mkdir = mkdir || false;

		validateUint32(this.#hwm, 'options.hwm');
		validateUint32(this.#minLength, 'options.minLength');
		validateUint32(this.#maxLength, 'options.maxLength');
		validateUint32(this.#maxWrite, 'options.maxWrite');
		validateUint32(this.#periodicFlush, 'options.periodicFlush');
		for (const [key, value] of [
			['sync', this.#sync],
			['fsync', this.#fsync],
			['append', this.#append],
			['mkdir', this.#mkdir],
		] as const) {
			if (typeof value != 'boolean') throw invalidArgType(`options.${key}`, 'boolean', value);
		}
		if (typeof this.#retryEAGAIN != 'function') throw invalidArgType('options.retryEAGAIN', 'function', this.#retryEAGAIN);
		if (contentMode != 'buffer' && contentMode != 'utf8')
			throw error(
				'ERR_INVALID_ARG_VALUE',
				`The property 'options.contentMode' must be one of: 'buffer', 'utf8'. Received ${JSON.stringify(contentMode)}`
			);

		this.#contentMode = contentMode;
		this.#writingBuf = contentMode == 'buffer' ? emptyBuffer : '';

		if (typeof fd == 'number') {
			this.#fd = fd;
			queueMicrotask(() => this.emit('ready'));
		} else if (typeof fd == 'string') {
			this.#openFile(fd);
		} else {
			throw invalidArgType('fd', 'number or string', fd);
		}

		if (this.#minLength >= this.#maxWrite)
			throw error(
				'ERR_INVALID_ARG_VALUE',
				`The argument 'minLength' should be smaller than maxWrite (${this.#maxWrite}). Received ${this.#minLength}`
			);

		if (this.#periodicFlush !== 0) {
			this.#periodicFlushTimer = setInterval(() => this.flush(), this.#periodicFlush);
			(this.#periodicFlushTimer as { unref?(): void }).unref?.();
		}
	}

	/**
	 * When `contentMode` is `utf8`, `data` must be a string. When it is `buffer`, `data` must be a `Buffer`.
	 * @returns Whether the internal buffer is below the high water mark
	 */
	public write(data: string | Buffer): boolean {
		if (this.#destroyed) throw invalidState('Utf8Stream is destroyed');

		if (this.#contentMode == 'buffer') {
			if (!Buffer.isBuffer(data)) throw invalidArgType('data', 'Buffer', data);
		} else if (typeof data != 'string') {
			throw invalidArgType('data', 'string', data);
		}

		const len = this.#len + data.length;

		if (this.#maxLength && len > this.#maxLength) {
			this.emit('drop', data);
			return this.#len < this.#hwm;
		}

		const last = this.#bufs.length - 1;

		if (this.#contentMode == 'buffer') {
			const bufs = this.#bufs as Buffer[][];
			if (!bufs.length || this.#lens[last] + data.length > this.#maxWrite) {
				bufs.push([data as Buffer]);
				this.#lens.push(data.length);
			} else {
				bufs[last].push(data as Buffer);
				this.#lens[last] += data.length;
			}
		} else {
			const bufs = this.#bufs as string[];
			if (!bufs.length || bufs[last].length + data.length > this.#maxWrite) bufs.push(data as string);
			else bufs[last] += data;
		}

		this.#len = len;

		if (!this.#writing && this.#len >= this.#minLength) this.#actualWrite();

		return this.#len < this.#hwm;
	}

	/**
	 * Writes the current buffer to the file if a write was not in progress.
	 * Does nothing if `minLength` is zero or if it is already writing.
	 */
	public flush(cb?: ((err: Error | null) => void) | null): void {
		if (cb !== undefined && cb !== null && typeof cb != 'function') throw invalidArgType('cb', 'function', cb);

		if (this.#destroyed) {
			const error = invalidState('Utf8Stream is destroyed');
			if (!cb) throw error;
			cb(error);
			return;
		}

		if (this.#minLength <= 0) {
			cb?.(null);
			return;
		}

		if (cb) this.#callFlushCallbackOnDrain(cb);

		if (this.#writing) return;

		if (!this.#bufs.length) {
			this.#bufs.push(this.#contentMode == 'buffer' ? [] : '');
			if (this.#contentMode == 'buffer') this.#lens.push(0);
		}

		this.#actualWrite();
	}

	/**
	 * Flushes the buffered data synchronously. This is a costly operation.
	 */
	public flushSync(): void {
		if (this.#destroyed) throw invalidState('Utf8Stream is destroyed');
		if (this.#fd < 0) throw invalidState('Invalid file descriptor');

		if (this.#contentMode == 'buffer') this.#flushSyncBuffer();
		else this.#flushSyncUtf8();
	}

	#flushSyncBuffer(): void {
		const bufs = this.#bufs as Buffer[][];

		if (!this.#writing && this.#writingBuf.length > 0) {
			bufs.unshift([this.#writingBuf as Buffer]);
			this.#writingBuf = emptyBuffer;
		}

		let buf: Buffer = emptyBuffer;
		while (bufs.length || buf.length) {
			if (buf.length <= 0) buf = _mergeBuffers(bufs[0], this.#lens[0]);
			const n = this.#fs.writeSync(this.#fd, buf);
			buf = buf.subarray(n);
			this.#len = Math.max(this.#len - n, 0);
			if (buf.length <= 0) {
				bufs.shift();
				this.#lens.shift();
			}
		}
	}

	#flushSyncUtf8(): void {
		const bufs = this.#bufs as string[];

		if (!this.#writing && this.#writingBuf.length > 0) {
			bufs.unshift(this.#writingBuf as string);
			this.#writingBuf = '';
		}

		let buf = '';
		while (bufs.length || buf) {
			if (buf.length <= 0) buf = bufs[0];
			const n = this.#fs.writeSync(this.#fd, buf, 'utf8');
			const released = _release(buf, this.#len, n);
			buf = released.writingBuf;
			this.#len = released.len;
			if (buf.length <= 0) bufs.shift();
		}

		try {
			this.#fs.fsyncSync(this.#fd);
		} catch {
			// Skip the error. The fd might not support fsync.
		}
	}

	/**
	 * Reopen the file in place, useful for log rotation.
	 */
	public reopen(file?: fs.PathLike): void {
		if (this.#destroyed) throw invalidState('Utf8Stream is destroyed');

		if (this.#opening) {
			this.once('ready', () => this.reopen(file));
			return;
		}

		if (this.#ending) return;

		if (!this.#file) throw error('ERR_OPERATION_FAILED', 'Unable to reopen a file descriptor, you must pass a file to Utf8Stream');

		if (file) this.#file = file.toString();
		this.#reopening = true;

		if (this.#writing) return;

		const fd = this.#fd;
		this.once('ready', () => {
			if (fd === this.#fd) return;
			this.#fs.close(fd, err => {
				if (err) this.emit('error', err);
			});
		});

		this.#openFile(this.#file);
	}

	/**
	 * Close the stream gracefully, flushing the internal buffer before closing.
	 */
	public end(): void {
		if (this.#destroyed) throw invalidState('Utf8Stream is destroyed');

		if (this.#opening) {
			this.once('ready', () => this.end());
			return;
		}

		if (this.#ending) return;

		this.#ending = true;

		if (this.#writing) return;

		if (this.#len > 0 && this.#fd >= 0) this.#actualWrite();
		else this.#actualClose();
	}

	/**
	 * Close the stream immediately, without flushing the internal buffer.
	 */
	public destroy(): void {
		if (this.#destroyed) return;
		this.#actualClose();
	}

	/** The mode of the file that is being written to */
	public get mode(): fs.Mode {
		return this.#mode;
	}

	/** The file that is being written to */
	public get file(): string {
		return this.#file!;
	}

	/** The file descriptor that is being written to */
	public get fd(): number {
		return this.#fd;
	}

	/** The minimum length of the internal buffer that is required to be full before flushing */
	public get minLength(): number {
		return this.#minLength;
	}

	/**
	 * The maximum length of the internal buffer.
	 * If a write would cause the buffer to exceed this, the data is dropped and a `drop` event is emitted with it.
	 */
	public get maxLength(): number {
		return this.#maxLength;
	}

	/** Whether the stream is currently writing data to the file */
	public get writing(): boolean {
		return this.#writing;
	}

	/** Whether the stream is writing synchronously or asynchronously */
	public get sync(): boolean {
		return this.#sync;
	}

	/** Whether the stream performs a `fsyncSync` after every write */
	public get fsync(): boolean {
		return this.#fsync;
	}

	/** Whether the stream is appending to the file or truncating it */
	public get append(): boolean {
		return this.#append;
	}

	/** The number of milliseconds between flushes. `0` means no periodic flushes are performed. */
	public get periodicFlush(): number {
		return this.#periodicFlush;
	}

	/** The type of data that can be written to the stream */
	public get contentMode(): 'utf8' | 'buffer' {
		return this.#contentMode;
	}

	/** Whether the directory for `file` is created if it does not exist */
	public get mkdir(): boolean {
		return this.#mkdir;
	}

	public [Symbol.dispose](): void {
		this.destroy();
	}

	#emitDrain(): void {
		if (!this.listenerCount('drain')) return;
		this.#asyncDrainScheduled = false;
		this.emit('drain');
	}

	#released(err: (Error & { code?: string }) | null, n: number = 0): void {
		if (err) {
			// Retrying is only possible for asynchronous writes.
			if (
				!this.#sync
				&& (err.code === 'EAGAIN' || err.code === 'EBUSY')
				&& this.#retryEAGAIN(err, this.#writingBuf.length, this.#len - this.#writingBuf.length)
			) {
				// Let's give the destination some time to process the chunk.
				setTimeout(() => this.#writeToFS(), busyWriteTimeout);
			} else {
				this.#writing = false;
				this.emit('error', err);
			}
			return;
		}

		this.emit('write', n);

		const released = _release(this.#writingBuf, this.#len, n);
		this.#len = released.len;
		this.#writingBuf = released.writingBuf;

		if (this.#writingBuf.length) {
			if (!this.#sync) {
				this.#writeToFS();
				return;
			}

			try {
				do {
					const written = this.#writeToFSSync();
					const released = _release(this.#writingBuf, this.#len, written);
					this.#len = released.len;
					this.#writingBuf = released.writingBuf;
				} while (this.#writingBuf.length);
			} catch (e: any) {
				this.#released(e);
				return;
			}
		}

		if (this.#fsync) this.#fs.fsyncSync(this.#fd);

		const len = this.#len;
		if (this.#reopening) {
			this.#writing = false;
			this.#reopening = false;
			this.reopen();
		} else if (len > this.#minLength) {
			this.#actualWrite();
		} else if (this.#ending) {
			if (len > 0) {
				this.#actualWrite();
			} else {
				this.#writing = false;
				this.#actualClose();
			}
		} else {
			this.#writing = false;
			if (!this.#sync) {
				this.emit('drain');
			} else if (!this.#asyncDrainScheduled) {
				this.#asyncDrainScheduled = true;
				queueMicrotask(() => this.#emitDrain());
			}
		}
	}

	#writeToFS(): void {
		if (this.#contentMode == 'buffer') this.#fs.write(this.#fd, this.#writingBuf as Buffer, (err, n) => this.#released(err, n));
		else this.#fs.write(this.#fd, this.#writingBuf as string, 'utf8', (err, n) => this.#released(err, n));
	}

	#writeToFSSync(): number {
		return this.#contentMode == 'buffer'
			? this.#fs.writeSync(this.#fd, this.#writingBuf as Buffer)
			: this.#fs.writeSync(this.#fd, this.#writingBuf as string, 'utf8');
	}

	#openFile(file: string): void {
		this.#opening = true;
		this.#writing = true;
		this.#asyncDrainScheduled = false;

		// Note: `error` and `ready` are only relevant when `sync` is false.
		// For sync mode, there is no way to add a listener that will receive these.
		const fileOpened = (err: Error | null, fd: number = -1) => {
			if (err) {
				this.#reopening = false;
				this.#writing = false;
				this.#opening = false;

				if (!this.#sync) this.emit('error', err);
				else queueMicrotask(() => void (this.listenerCount('error') && this.emit('error', err)));

				return;
			}

			const reopening = this.#reopening;

			this.#fd = fd;
			this.#file = file;
			this.#reopening = false;
			this.#opening = false;
			this.#writing = false;

			if (!this.#sync) this.emit('ready');
			else queueMicrotask(() => this.emit('ready'));

			if (this.#destroyed) return;

			if ((!this.#writing && this.#len > this.#minLength) || this.#flushPending) this.#actualWrite();
			else if (reopening) queueMicrotask(() => this.emit('drain'));
		};

		const flags = this.#append ? 'a' : 'w';
		const mode = this.#mode ?? 0o666;

		if (this.#sync) {
			try {
				if (this.#mkdir) this.#fs.mkdirSync(dirname(file), { recursive: true });
				fileOpened(null, this.#fs.openSync(file, flags, mode));
			} catch (e: any) {
				fileOpened(e);
				throw e;
			}
		} else if (this.#mkdir) {
			this.#fs.mkdir(dirname(file), { recursive: true }, err => {
				if (err) return fileOpened(err);
				this.#fs.open(file, flags, mode, fileOpened);
			});
		} else {
			this.#fs.open(file, flags, mode, fileOpened);
		}
	}

	#actualClose(): void {
		if (this.#fd === -1) {
			this.once('ready', () => this.#actualClose());
			return;
		}

		if (this.#periodicFlushTimer !== undefined) clearInterval(this.#periodicFlushTimer);

		this.#destroyed = true;
		this.#bufs = [];
		this.#lens = [];

		const done = (err: Error | null) => {
			if (err) {
				this.emit('error', err);
				return;
			}

			if (this.#ending && !this.#writing) this.emit('finish');
			this.emit('close');
		};

		const closeWrapped = () => {
			// Don't close stdout or stderr
			if (this.#fd !== 1 && this.#fd !== 2) this.#fs.close(this.#fd, done);
			else done(null);
		};

		try {
			// We skip errors in fsync
			this.#fs.fsync(this.#fd, closeWrapped);
		} catch {
			// Intentionally empty.
		}
	}

	#actualWrite(): void {
		this.#writing = true;

		if (this.#contentMode == 'buffer') {
			this.#writingBuf = this.#writingBuf.length
				? this.#writingBuf
				: _mergeBuffers((this.#bufs.shift() as Buffer[]) ?? [], this.#lens.shift() ?? 0);
		} else {
			this.#writingBuf ||= (this.#bufs.shift() as string) || '';
		}

		if (!this.#sync) {
			this.#writeToFS();
			return;
		}

		try {
			this.#released(null, this.#writeToFSSync());
		} catch (e: any) {
			this.#released(e);
		}
	}

	#callFlushCallbackOnDrain(cb: (err: Error | null) => void): void {
		this.#flushPending = true;

		const onDrain = () => {
			// Only if fsync is false to avoid double fsync
			if (this.#fsync || this.#destroyed) {
				this.#flushPending = false;
				cb(null);
			} else {
				try {
					this.#fs.fsync(this.#fd, err => {
						this.#flushPending = false;
						// If the fd is closed, we ignore the error.
						cb((err as Error & { code?: string })?.code == 'EBADF' ? null : err);
					});
				} catch (e: any) {
					this.#flushPending = false;
					cb(e);
				}
			}
			this.off('error', onError);
		};

		const onError = (err: Error) => {
			this.#flushPending = false;
			cb(err);
			this.off('drain', onDrain);
		};

		this.once('drain', onDrain);
		this.once('error', onError);
	}

	// Node relies on the `newListener` event to know when a `drain` listener is added.
	// `eventemitter3` does not have it, so the listener methods are patched instead.

	public on<T extends keyof fs.Utf8StreamEventMap>(event: T, fn: (...args: fs.Utf8StreamEventMap[T]) => void, context?: any): this {
		if (event === 'drain') this.#asyncDrainScheduled = false;
		return super.on(event, fn, context);
	}

	public addListener<T extends keyof fs.Utf8StreamEventMap>(event: T, fn: (...args: fs.Utf8StreamEventMap[T]) => void, context?: any): this {
		return this.on(event, fn, context);
	}

	public once<T extends keyof fs.Utf8StreamEventMap>(event: T, fn: (...args: fs.Utf8StreamEventMap[T]) => void, context?: any): this {
		if (event === 'drain') this.#asyncDrainScheduled = false;
		return super.once(event, fn, context);
	}

	public off<T extends keyof fs.Utf8StreamEventMap>(event: T, fn?: (...args: any[]) => void, context?: any, once?: boolean): this {
		return super.off(event, fn as EventEmitter.EventListener<fs.Utf8StreamEventMap, T>, context, once);
	}

	public removeListener<T extends keyof fs.Utf8StreamEventMap>(event: T, fn?: (...args: any[]) => void, context?: any, once?: boolean): this {
		return super.removeListener(event, fn as EventEmitter.EventListener<fs.Utf8StreamEventMap, T>, context, once);
	}

	public setMaxListeners(): never {
		throw UV('ENOSYS', 'Utf8Stream.setMaxListeners');
	}

	public getMaxListeners(): never {
		throw UV('ENOSYS', 'Utf8Stream.getMaxListeners');
	}

	public prependListener(): never {
		throw UV('ENOSYS', 'Utf8Stream.prependListener');
	}

	public prependOnceListener(): never {
		throw UV('ENOSYS', 'Utf8Stream.prependOnceListener');
	}

	public rawListeners(): never {
		throw UV('ENOSYS', 'Utf8Stream.rawListeners');
	}
}
Utf8Stream satisfies typeof fs.Utf8Stream;
