import type * as Node from 'fs';
import { Readable, Writable } from 'readable-stream';
import { Callback } from '../utils.js';

export class ReadStream extends Readable implements Node.ReadStream {
	close(callback: Callback = () => null): void {
		try {
			super.destroy();
			super.emit('close');
			callback();
		} catch (err) {
			callback(err);
		}
	}
	bytesRead: number;
	path: string | Buffer;
	pending: boolean;

	addListener(event: 'close', listener: () => void): this;
	addListener(event: 'data', listener: (chunk: Buffer | string) => void): this;
	addListener(event: 'end', listener: () => void): this;
	addListener(event: 'error', listener: (err: Error) => void): this;
	addListener(event: 'open', listener: (fd: number) => void): this;
	addListener(event: 'pause', listener: () => void): this;
	addListener(event: 'readable', listener: () => void): this;
	addListener(event: 'ready', listener: () => void): this;
	addListener(event: 'resume', listener: () => void): this;
	addListener(event: string | symbol, listener: (...args) => void): this {
		return super.addListener(event, listener);
	}

	on(event: 'close', listener: () => void): this;
	on(event: 'data', listener: (chunk: Buffer | string) => void): this;
	on(event: 'end', listener: () => void): this;
	on(event: 'error', listener: (err: Error) => void): this;
	on(event: 'open', listener: (fd: number) => void): this;
	on(event: 'pause', listener: () => void): this;
	on(event: 'readable', listener: () => void): this;
	on(event: 'ready', listener: () => void): this;
	on(event: 'resume', listener: () => void): this;
	on(event: string | symbol, listener: (...args) => void): this {
		return super.on(event, listener);
	}

	once(event: 'close', listener: () => void): this;
	once(event: 'data', listener: (chunk: Buffer | string) => void): this;
	once(event: 'end', listener: () => void): this;
	once(event: 'error', listener: (err: Error) => void): this;
	once(event: 'open', listener: (fd: number) => void): this;
	once(event: 'pause', listener: () => void): this;
	once(event: 'readable', listener: () => void): this;
	once(event: 'ready', listener: () => void): this;
	once(event: 'resume', listener: () => void): this;
	once(event: string | symbol, listener: (...args) => void): this {
		return super.once(event, listener);
	}

	prependListener(event: 'close', listener: () => void): this;
	prependListener(event: 'data', listener: (chunk: Buffer | string) => void): this;
	prependListener(event: 'end', listener: () => void): this;
	prependListener(event: 'error', listener: (err: Error) => void): this;
	prependListener(event: 'open', listener: (fd: number) => void): this;
	prependListener(event: 'pause', listener: () => void): this;
	prependListener(event: 'readable', listener: () => void): this;
	prependListener(event: 'ready', listener: () => void): this;
	prependListener(event: 'resume', listener: () => void): this;
	prependListener(event: string | symbol, listener: (...args) => void): this {
		return super.prependListener(event, listener);
	}

	prependOnceListener(event: 'close', listener: () => void): this;
	prependOnceListener(event: 'data', listener: (chunk: Buffer | string) => void): this;
	prependOnceListener(event: 'end', listener: () => void): this;
	prependOnceListener(event: 'error', listener: (err: Error) => void): this;
	prependOnceListener(event: 'open', listener: (fd: number) => void): this;
	prependOnceListener(event: 'pause', listener: () => void): this;
	prependOnceListener(event: 'readable', listener: () => void): this;
	prependOnceListener(event: 'ready', listener: () => void): this;
	prependOnceListener(event: 'resume', listener: () => void): this;
	prependOnceListener(event: string | symbol, listener: (...args) => void): this {
		return super.prependOnceListener(event, listener);
	}
}

export class WriteStream extends Writable implements Node.WriteStream {
	close(callback: Callback = () => null): void {
		try {
			super.destroy();
			super.emit('close');
			callback();
		} catch (err) {
			callback(err);
		}
	}
	bytesWritten: number;
	path: string | Buffer;
	pending: boolean;

	addListener(event: 'close', listener: () => void): this;
	addListener(event: 'drain', listener: () => void): this;
	addListener(event: 'error', listener: (err: Error) => void): this;
	addListener(event: 'finish', listener: () => void): this;
	addListener(event: 'open', listener: (fd: number) => void): this;
	addListener(event: 'pipe', listener: (src: Readable) => void): this;
	addListener(event: 'ready', listener: () => void): this;
	addListener(event: 'unpipe', listener: (src: Readable) => void): this;
	addListener(event: string | symbol, listener: (...args) => void): this;
	addListener(event: string | symbol, listener: (...args) => void): this {
		return super.addListener(event, listener);
	}
	on(event: 'close', listener: () => void): this;
	on(event: 'drain', listener: () => void): this;
	on(event: 'error', listener: (err: Error) => void): this;
	on(event: 'finish', listener: () => void): this;
	on(event: 'open', listener: (fd: number) => void): this;
	on(event: 'pipe', listener: (src: Readable) => void): this;
	on(event: 'ready', listener: () => void): this;
	on(event: 'unpipe', listener: (src: Readable) => void): this;
	on(event: string | symbol, listener: (...args) => void): this;
	on(event: string | symbol, listener: (...args) => void): this {
		return super.on(event, listener);
	}
	once(event: 'close', listener: () => void): this;
	once(event: 'drain', listener: () => void): this;
	once(event: 'error', listener: (err: Error) => void): this;
	once(event: 'finish', listener: () => void): this;
	once(event: 'open', listener: (fd: number) => void): this;
	once(event: 'pipe', listener: (src: Readable) => void): this;
	once(event: 'ready', listener: () => void): this;
	once(event: 'unpipe', listener: (src: Readable) => void): this;
	once(event: string | symbol, listener: (...args) => void): this;
	once(event: string | symbol, listener: (...args) => void): this {
		return super.once(event, listener);
	}
	prependListener(event: 'close', listener: () => void): this;
	prependListener(event: 'drain', listener: () => void): this;
	prependListener(event: 'error', listener: (err: Error) => void): this;
	prependListener(event: 'finish', listener: () => void): this;
	prependListener(event: 'open', listener: (fd: number) => void): this;
	prependListener(event: 'pipe', listener: (src: Readable) => void): this;
	prependListener(event: 'ready', listener: () => void): this;
	prependListener(event: 'unpipe', listener: (src: Readable) => void): this;
	prependListener(event: string | symbol, listener: (...args) => void): this;
	prependListener(event: string | symbol, listener: (...args) => void): this {
		return super.prependListener(event, listener);
	}
	prependOnceListener(event: 'close', listener: () => void): this;
	prependOnceListener(event: 'drain', listener: () => void): this;
	prependOnceListener(event: 'error', listener: (err: Error) => void): this;
	prependOnceListener(event: 'finish', listener: () => void): this;
	prependOnceListener(event: 'open', listener: (fd: number) => void): this;
	prependOnceListener(event: 'pipe', listener: (src: Readable) => void): this;
	prependOnceListener(event: 'ready', listener: () => void): this;
	prependOnceListener(event: 'unpipe', listener: (src: Readable) => void): this;
	prependOnceListener(event: string | symbol, listener: (...args) => void): this;
	prependOnceListener(event: string | symbol, listener: (...args) => void): this {
		return super.prependOnceListener(event, listener);
	}
}
