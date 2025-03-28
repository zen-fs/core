import assert from 'node:assert';
import { suite, test } from 'node:test';
import { Worker } from 'worker_threads';
import { fs, mount, resolveMountConfig, SingleBuffer } from '../../dist/index.js';
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

	test('cross-thread SharedArrayBuffer', { todo: true }, async () => {
		const sharedBuffer = new SharedArrayBuffer(0x100000);

		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer: sharedBuffer });
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
});
