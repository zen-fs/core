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
}
