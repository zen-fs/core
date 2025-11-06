// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { suite, test } from 'node:test';
import { Worker } from 'worker_threads';
import { fs, mount, resolveMountConfig, SingleBuffer, vfs } from '@zenfs/core';
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

	test('reliability across varied file sizes', async () => {
		const mountPoint = '/sbfs-reliability';
		const verifyMountPoint = '/sbfs-verify';
		const buffer = new ArrayBuffer(0x400000);
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer, label: 'reliability' });
		mount(mountPoint, writable);

		const filePath = `${mountPoint}/payload.bin`;
		const growthSizes = [0, 1, 17, 512, 8192, 65535, 262144, 524288];
		const shrinkSizes = [262144, 4096, 128, 0];

		const verifySnapshot = async (expected: Buffer, size: number) => {
			const snapshotFs = await resolveMountConfig({ backend: SingleBuffer, buffer });
			mount(verifyMountPoint, snapshotFs);
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
				const payload = size ? randomBytes(size) : new Uint8Array();
				fs.writeFileSync(filePath, payload);
				const direct = fs.readFileSync(filePath);
				assert.strictEqual(direct.byteLength, size, `direct size mismatch for ${size} bytes`);
				assert.deepStrictEqual(direct, payload, `direct content mismatch for ${size} bytes`);
				await verifySnapshot(direct, size);
			}

			for (const size of shrinkSizes) {
				const payload = size ? randomBytes(size) : new Uint8Array();
				fs.writeFileSync(filePath, payload);
				const direct = fs.readFileSync(filePath);
				assert.strictEqual(direct.byteLength, size, `direct size mismatch after shrink to ${size} bytes`);
				assert.deepStrictEqual(direct, payload, `direct content mismatch after shrink to ${size} bytes`);
				await verifySnapshot(direct, size);
			}
		} finally {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
			vfs.umount(mountPoint);
		}
	});
});
