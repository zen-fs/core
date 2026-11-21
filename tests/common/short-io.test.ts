// SPDX-License-Identifier: LGPL-3.0-or-later
import { constants, fs, InMemoryStore, StoreFS, vfs } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

/** A character device at `/device` that gives at most 3 bytes per read and takes at most 2 per write */
class ShortFS extends StoreFS<InMemoryStore> {
	public pending = new TextEncoder().encode('abcdefg');
	public written: number[] = [];

	public constructor() {
		super(new InMemoryStore());
	}

	public readSync(path: string, buffer: Uint8Array, start: number, end: number): number {
		if (path != '/device') return super.readSync(path, buffer, start, end);
		const data = this.pending.subarray(0, Math.min(3, end - start));
		this.pending = this.pending.subarray(data.byteLength);
		buffer.set(data);
		return data.byteLength;
	}

	public async read(path: string, buffer: Uint8Array, start: number, end: number): Promise<number> {
		return path == '/device' ? this.readSync(path, buffer, start, end) : await super.read(path, buffer, start, end);
	}

	public writeSync(path: string, buffer: Uint8Array, offset: number): number {
		if (path != '/device') return super.writeSync(path, buffer, offset);
		const data = buffer.subarray(0, 2);
		this.written.push(...data);
		return data.byteLength;
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<number> {
		return path == '/device' ? this.writeSync(path, buffer, offset) : await super.write(path, buffer, offset);
	}
}

function mountShort(): ShortFS {
	const short = new ShortFS();
	short.checkRootSync();
	short.createFileSync('/device', { mode: 0o666, uid: 0, gid: 0 });
	short.touchSync('/device', { mode: constants.S_IFCHR | 0o666 });
	fs.mkdirSync('/short', { recursive: true });
	vfs.mount('/short', short);
	return short;
}

suite('Short reads and writes', () => {
	test('a device read reports and advances by what the device gave', () => {
		mountShort();
		try {
			const fd = fs.openSync('/short/device', 'r+');
			const buffer = new Uint8Array(8);
			assert.equal(fs.readSync(fd, buffer, 0, 8, null), 3);
			assert.equal(new TextDecoder().decode(buffer.subarray(0, 3)), 'abc');
			assert.equal(fs.readSync(fd, buffer, 0, 8, null), 3);
			assert.equal(new TextDecoder().decode(buffer.subarray(0, 3)), 'def');
			fs.closeSync(fd);
		} finally {
			vfs.umountSync('/short');
		}
	});

	test('a device write reports what the device took', async () => {
		const short = mountShort();
		try {
			await using handle = await fs.promises.open('/short/device', 'r+');
			const { bytesWritten } = await handle.write(new Uint8Array([1, 2, 3, 4, 5]));
			assert.equal(bytesWritten, 2);
			assert.deepEqual(short.written, [1, 2]);
		} finally {
			vfs.umountSync('/short');
		}
	});

	test('a device stream writes every byte through short writes', async () => {
		const short = mountShort();
		try {
			await using handle = await fs.promises.open('/short/device', 'r+');
			const writer = handle.writableWebStream().getWriter();
			await writer.write(new Uint8Array([1, 2, 3, 4, 5]));
			await writer.close();
			assert.deepEqual(short.written, [1, 2, 3, 4, 5]);
		} finally {
			vfs.umountSync('/short');
		}
	});
});
