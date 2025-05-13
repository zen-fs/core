import assert from 'node:assert';
import { suite, test } from 'node:test';
import { Worker } from 'worker_threads';
import { fs, mount, resolveMountConfig, SingleBuffer } from '../../dist/index.js';
import { setupLogs } from '../logs.js';
import { Passthrough } from '../../dist/index.js';
import nodeFS from 'node:fs';
import path from 'node:path';

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

	test('should recursively copy files with with same stats', async () => {
		const buffer = new ArrayBuffer(0x100000);

		const source = await resolveMountConfig({ backend: Passthrough, fs: nodeFS, prefix: path.join(process.cwd(), 'tests/data') });
		mount('/src', source);

		const dest = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/dst', dest);

		fs.cpSync('/src', '/dst', { recursive: true, force: true, preserveTimestamps: true });

		// recursively walk through the directory and check that files are the same
		const files = fs.readdirSync('/src', { withFileTypes: true, recursive: true });
		for (const file of files) {
			const srcFile = path.join('/src', file.name);
			const dstFile = path.join('/dst', file.name);
			assert(fs.existsSync(dstFile));

			const stats = fs.statSync(srcFile);
			const dstStats = fs.statSync(dstFile);
			assert.strictEqual(stats, dstStats);

			if (file.isFile()) {
				const srcContent = fs.readFileSync(srcFile, 'utf-8');
				const dstContent = fs.readFileSync(dstFile, 'utf-8');
				assert.strictEqual(srcContent, dstContent);
			}
		}
	});
});
