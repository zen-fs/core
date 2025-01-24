import assert from 'node:assert/strict';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { Fetch, configureSingle, fs } from '../../dist/index.js';
import { baseUrl, defaultEntries, indexPath, whenServerReady } from '../fetch/config.js';

const server = new Worker(join(import.meta.dirname, '../fetch/server.js'));

await whenServerReady();

await suite('Fetch with `disableAsyncCache`', () => {
	test('Configuration', async () => {
		await configureSingle({
			backend: Fetch,
			disableAsyncCache: true,
			baseUrl,
			index: baseUrl + indexPath,
		});
	});

	test('Read and write file', async () => {
		await fs.promises.writeFile('/example', 'test');

		const contents = await fs.promises.readFile('/example', 'utf8');

		assert.equal(contents, 'test');
	});

	test('Make new directory', async () => {
		await fs.promises.mkdir('/duck');
		const stats = await fs.promises.stat('/duck');
		assert(stats.isDirectory());
	});

	test('Read directory', async () => {
		const entries = await fs.promises.readdir('/');

		assert.deepEqual(entries, [...defaultEntries, 'example', 'duck']);
	});

	test('Uncached synchronous operations throw', () => {
		assert.throws(() => fs.readFileSync('/x.txt', 'utf8'), { code: 'EAGAIN' });
	});
});

await server.terminate();
server.unref();
