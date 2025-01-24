import assert from 'node:assert/strict';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { Fetch, configureSingle, fs } from '../../dist/index.js';
import { baseUrl, indexPath, whenServerReady } from '../fetch/config.js';

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

	test('Read and write', async () => {
		await fs.promises.writeFile('/example', 'test');

		const contents = await fs.promises.readFile('/example', 'utf8');

		assert.equal(contents, 'test');
	});
});

await server.terminate();
server.unref();
