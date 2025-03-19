import { test, suite } from 'node:test';
import { fs, mount, resolveMountConfig, SingleBuffer, umount } from '../../dist/index.js';
import assert from 'node:assert';
import { Worker } from 'worker_threads';

await suite('SingleBuffer', () => {
	test('should be able to restore filesystem (with same metadata) from original buffer', async () => {
		const buffer = new ArrayBuffer(0x100000);

		umount('/');
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/', writable);

		fs.writeFileSync('/example.ts', 'console.log("hello world")', 'utf-8');
		const stats = fs.statSync('/example.ts');

		umount('/');
		const snapshot = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/', snapshot);

		const snapshotStats = fs.statSync('/example.ts');

		assert.deepEqual(snapshotStats, stats);
	});

	test('should support SharedArrayBuffer across threads', async () => {
		const sharedBuffer = new SharedArrayBuffer(0x100000);

		umount('/');
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer: sharedBuffer });
		mount('/', writable);

		const worker = new Worker(import.meta.dirname + '/single-buffer.worker.js', { workerData: sharedBuffer });

		// Pause while we wait for the worker to emit the 'continue' message, which
		// means it has mounted the filesystem and created /worker-file.ts
		await new Promise<void>(resolve => {
			worker.on('message', message => {
				if (message === 'continue') resolve();
			});
		});

		worker.terminate();
		worker.unref();

		assert(fs.existsSync('/worker-file.ts'));
	});
});
