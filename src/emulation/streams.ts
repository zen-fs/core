import type * as Node from 'fs';
import { Readable, Writable } from 'readable-stream';
import { Callback } from '../utils.js';
import { ApiError, ErrorCode } from '../ApiError.js';

export class ReadStream extends Readable implements Node.ReadStream {
	close(callback: Callback = () => null): void {
		try {
			super.destroy();
			super.emit('close');
			callback();
		} catch (err) {
			callback(new ApiError(ErrorCode.EIO, (err as Error).toString()));
		}
	}
	declare bytesRead: number;
	declare path: string | Buffer;
	declare pending: boolean;
}

export class WriteStream extends Writable implements Node.WriteStream {
	close(callback: Callback = () => null): void {
		try {
			super.destroy();
			super.emit('close');
			callback();
		} catch (err) {
			callback(new ApiError(ErrorCode.EIO, (err as Error).toString()));
		}
	}
	declare bytesWritten: number;
	declare path: string | Buffer;
	declare pending: boolean;
}
