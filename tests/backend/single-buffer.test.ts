// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { suite, test } from 'node:test';
import { Worker } from 'worker_threads';
import { fs, mount, resolveMountConfig, SingleBuffer, vfs } from '@zenfs/core';
import { SuperBlock } from '@zenfs/core/backends/single_buffer';
import { setupLogs } from '../logs.js';

setupLogs();

await suite('SingleBuffer', () => {
	test('filesystem restoration from original buffer (with same metadata)', async () => {
		const buffer = new ArrayBuffer(0x100000);

		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/mnt', writable);

		fs.writeFileSync('/mnt/example.ts', 'console.log("hello world")', 'utf-8');
		const stats = fs.statSync('/mnt/example.ts');

		const snapshot = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/snapshot', snapshot);

		const snapshotStats = fs.statSync('/snapshot/example.ts');

		assert.deepEqual(snapshotStats, stats);
	});

	test('cross-thread SharedArrayBuffer', async () => {
		const sharedBuffer = new SharedArrayBuffer(0x100000);

		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer: sharedBuffer });
		fs.mkdirSync('/shared');
		mount('/shared', writable);

		const worker = new Worker(import.meta.dirname + '/single-buffer.worker.js', { workerData: sharedBuffer });

		const { promise, resolve, reject } = Promise.withResolvers<void>();

		setTimeout(reject, 1000);
		worker.on('message', message => {
			if (message === 'continue') resolve();
			else reject(message ?? new Error('Failed'));
		});

		await promise;

		await worker.terminate();
		worker.unref();

		assert(fs.existsSync('/shared/worker-file.ts'));
	});

	test('metadata table grows while keeping every id retrievable', () => {
		const superblock = new SuperBlock(new ArrayBuffer(0x100000));
		const offsets = new Map<number, number>();

		for (let i = 0; i < 500; i++) {
			const id = i * 2 + 1;
			const offset = superblock.allocate(16);
			superblock.insert(id, offset, 16);
			offsets.set(id, offset);
		}

		assert(superblock.table_capacity >= 512, 'the table grew to hold 500 entries');
		for (const [id, offset] of offsets) assert.strictEqual(superblock.lookup(id)?.offset, offset, `id ${id} is retrievable`);

		for (const id of offsets.keys()) if (id % 4 === 1) superblock.remove(id);

		for (const [id, offset] of offsets) {
			if (id % 4 === 1) assert.strictEqual(superblock.lookup(id), undefined, `id ${id} was removed`);
			else assert.strictEqual(superblock.lookup(id)?.offset, offset, `id ${id} is still present`);
		}
	});

	test('reliability across varied file sizes', async () => {
		const mountPoint = '/sbfs-reliability';
		const verifyMountPoint = '/sbfs-verify';
		const buffer = new ArrayBuffer(0x400000);
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer, label: 'reliability' });
		mount(mountPoint, writable);

		const filePath = `${mountPoint}/payload.bin`;
		const growthSizes = [0, 1, 17, 512, 8192, 65535, 262144, 524288];
		const shrinkSizes = [262144, 4096, 128, 0];

		const verifySnapshot = (expected: Buffer, size: number) => {
			mount(verifyMountPoint, writable);
			try {
				const reopened = fs.readFileSync(`${verifyMountPoint}/payload.bin`);
				assert.strictEqual(reopened.byteLength, size, `snapshot size mismatch for ${size} bytes`);
				assert.deepStrictEqual(reopened, expected, `snapshot content mismatch for ${size} bytes`);
			} finally {
				vfs.umount(verifyMountPoint);
			}
		};

		try {
			for (const size of growthSizes) {
				const payload = size ? randomBytes(size) : Buffer.alloc(0);
				fs.writeFileSync(filePath, payload);
				const direct = fs.readFileSync(filePath);
				assert.strictEqual(direct.byteLength, size, `direct size mismatch for ${size} bytes`);
				assert.deepStrictEqual(direct, payload, `direct content mismatch for ${size} bytes`);
				verifySnapshot(direct, size);
			}

			for (const size of shrinkSizes) {
				const payload = size ? randomBytes(size) : Buffer.alloc(0);
				fs.writeFileSync(filePath, payload);
				const direct = fs.readFileSync(filePath);
				assert.strictEqual(direct.byteLength, size, `direct size mismatch after shrink to ${size} bytes`);
				assert.deepStrictEqual(direct, payload, `direct content mismatch after shrink to ${size} bytes`);
				verifySnapshot(direct, size);
			}
		} finally {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
			vfs.umount(mountPoint);
		}
	});

	test('keeps metadata aligned when files have uneven sizes #309', async () => {
		const mountPoint = '/sbfs-rotation';
		const buffer = new ArrayBuffer(0x400000);
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer, label: 'rotation' });
		mount(mountPoint, writable);

		const sizes = [1, 17, 257, 3, 5, 13, 1023, 4095, 7, 9];
		try {
			for (let i = 0; i < 400; i++) {
				const content = Buffer.alloc(sizes[i % sizes.length], i & 0xff);
				fs.writeFileSync(`${mountPoint}/f${i}.txt`, content);
			}
			for (let i = 0; i < 400; i += 37) {
				const expected = Buffer.alloc(sizes[i % sizes.length], i & 0xff);
				assert.deepStrictEqual(fs.readFileSync(`${mountPoint}/f${i}.txt`), expected, `content mismatch at f${i}.txt`);
			}
		} finally {
			vfs.umount(mountPoint);
		}
	});

	test('reuses freed space across many write/delete cycles #323', async () => {
		const buffer = new ArrayBuffer(0x100000);
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/sbfs-churn', writable);

		const payload = randomBytes(4096);
		try {
			for (let i = 0; i < 2000; i++) {
				fs.writeFileSync('/sbfs-churn/a', payload);
				fs.rmSync('/sbfs-churn/a');
			}

			fs.writeFileSync('/sbfs-churn/a', payload);
			assert.deepStrictEqual(fs.readFileSync('/sbfs-churn/a'), payload);
		} finally {
			vfs.umount('/sbfs-churn');
		}
	});

	test('reuses and coalesces freed regions', () => {
		const superblock = new SuperBlock(new ArrayBuffer(0x10000));

		const first = superblock.allocate(4096);
		const second = superblock.allocate(4096);
		superblock.allocate(4096);

		superblock.free(second, 4096);
		assert.strictEqual(superblock.allocate(4096), second, 'a freed region is reused');

		superblock.free(first, 4096);
		superblock.free(second, 4096);
		assert.strictEqual(superblock.allocate(8192), first, 'adjacent freed regions coalesce into one');
		assert.strictEqual(superblock.free_bytes, 0n);
	});

	test('recovers all space after freeing every allocation', () => {
		const superblock = new SuperBlock(new ArrayBuffer(0x4000));

		const offsets: number[] = [];
		assert.throws(
			() => {
				for (;;) offsets.push(superblock.allocate(512));
			},
			{ code: 'ENOSPC' }
		);

		for (const offset of offsets) superblock.free(offset, 512);

		let refilled = 0;
		assert.throws(
			() => {
				for (;;) {
					superblock.allocate(512);
					refilled++;
				}
			},
			{ code: 'ENOSPC' }
		);

		assert.strictEqual(refilled, offsets.length, 'every freed region is reusable');
		assert.strictEqual(superblock.free_bytes, 0n);
	});
});
