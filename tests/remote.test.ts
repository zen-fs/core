import { Worker } from 'node:worker_threads';
import { fs, configure } from '@zenfs/core';
import { Worker as WorkerBackend } from '../src/backend.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const worker = new Worker(__dirname + '/remote-worker.js');
await configure({
	'/': { backend: WorkerBackend, worker },
});
const content = 'FS is in a worker';
await fs.promises.writeFile('test', content);
expect(await fs.promises.readFile('test', 'utf8')).toBe(content);
/*
describe('Remote FS test', () => {
	const worker = new Worker(__dirname + '/remote-worker.js');

	test('read', async () => {
		try {
			await configure({
				'/': { backend: WorkerBackend, worker },
			});
			const content = 'FS is in a worker';
			await fs.promises.writeFile('test', content);
			expect(await fs.promises.readFile('test', 'utf8')).toBe(content);
		} catch (e) {
			console.error(e);
			fail(e);
		}
	});
});*/
