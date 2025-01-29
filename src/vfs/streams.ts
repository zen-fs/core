import type * as fs from 'node:fs';
import type { Callback } from '../utils.js';

import { Readable, Writable } from 'readable-stream';
import { Errno, ErrnoError } from '../internal/error.js';

export class ReadStream extends Readable implements fs.ReadStream {
	close(callback: Callback<[void], null> = () => null): void {
		try {
			super.destroy();
			super.emit('close');
			callback(null);
		} catch (err) {
			callback(new ErrnoError(Errno.EIO, (err as Error).toString()));
		}
	}
	wrap(oldStream: NodeJS.ReadableStream): this {
		super.wrap(oldStream as any);
		return this;
	}
	declare bytesRead: number;
	declare path: string | Buffer;
	declare pending: boolean;
}

export class WriteStream extends Writable implements fs.WriteStream {
	close(callback: Callback<[void], null> = () => null): void {
		try {
			super.destroy();
			super.emit('close');
			callback(null);
		} catch (err) {
			callback(new ErrnoError(Errno.EIO, (err as Error).toString()));
		}
	}
	declare bytesWritten: number;
	declare path: string | Buffer;
	declare pending: boolean;
}
