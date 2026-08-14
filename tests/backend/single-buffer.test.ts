// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { suite, test } from 'node:test';
import { Worker } from 'worker_threads';
import { fs, mount, resolveMountConfig, SingleBuffer, vfs } from '@zenfs/core';
import { SuperBlock } from '@zenfs/core/backends/single_buffer.js';
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

		// Pause while we wait for the worker to emit the 'continue' message, which
		// means it has mounted the filesystem and created /worker-file.ts
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

	test('aligns metadata after another thread reserves space #309', async () => {
		const buffer = new SharedArrayBuffer(0x100000);
		const gate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
		const superblock = new SuperBlock(buffer);
		const usedBytes = 2;
		superblock.used_bytes = 8193n;

		const worker = new Worker(
			`const { parentPort, workerData } = require('node:worker_threads');
			const superblock = new BigUint64Array(workerData.buffer);
			parentPort.postMessage('ready');
			Atomics.wait(workerData.gate, 0, 0);
			Atomics.add(superblock, workerData.usedBytes, 5n);
			Atomics.store(workerData.gate, 0, 2);
			Atomics.notify(workerData.gate, 0);`,
			{ eval: true, workerData: { buffer, gate, usedBytes } }
		);
		const add = Atomics.add;
		const compareExchange = Atomics.compareExchange;
		let injected = false;

		// Let the worker claim space just before this thread updates used_bytes.
		const injectConcurrentAllocation = (view: BigUint64Array, index: number) => {
			if (injected || view !== superblock || index !== usedBytes) return;
			injected = true;
			Atomics.store(gate, 0, 1);
			Atomics.notify(gate, 0);
			const wait = Atomics.wait(gate, 0, 1, 1000);
			assert.notStrictEqual(wait, 'timed-out', 'worker did not reserve data in time');
			assert.strictEqual(Atomics.load(gate, 0), 2);
		};

		try {
			await new Promise<void>((resolve, reject) => {
				worker.once('message', message => (message === 'ready' ? resolve() : reject(new Error(`Unexpected worker message: ${message}`))));
				worker.once('error', reject);
			});

			Atomics.add = ((view: BigUint64Array, index: number, value: bigint) => {
				injectConcurrentAllocation(view, index);
				return add(view, index, value);
			}) as typeof Atomics.add;
			Atomics.compareExchange = ((view: BigUint64Array, index: number, expected: bigint, replacement: bigint) => {
				injectConcurrentAllocation(view, index);
				return compareExchange(view, index, expected, replacement);
			}) as typeof Atomics.compareExchange;

			const metadata = superblock.rotateMetadata();
			assert.strictEqual(metadata.byteOffset, 8200);
			assert.strictEqual(metadata.byteOffset % Int32Array.BYTES_PER_ELEMENT, 0);
			assert(injected, 'test did not inject a concurrent allocation');
		} finally {
			Atomics.add = add;
			Atomics.compareExchange = compareExchange;
			await worker.terminate();
			worker.unref();
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

		// Uneven writes leave used_bytes between alignment boundaries when the
		// metadata block fills up.
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
});
