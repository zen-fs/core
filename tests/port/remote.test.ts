import assert from 'node:assert';
import { dirname } from 'node:path';
import { suite, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Worker } from 'node:worker_threads';
import { Port } from '../../src/backends/port/fs.ts';
import { configureSingle, fs } from '../../src/index.ts';
import { createTSWorker } from '../common.ts';

const dir = dirname(fileURLToPath(import.meta.url));

const port: Worker = createTSWorker(dir + '/remote.worker.js');

await suite('Remote FS', () => {
	const content = 'FS is in a port';

	test('Configuration', async () => {
		await configureSingle({ backend: Port, port, timeout: 500 });
	});

	test('Write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('Read', async () => {
		assert((await fs.promises.readFile('/test', 'utf8')) === content);
	});

	test('Cleanup', async () => {});
});

await port.terminate();
port.unref();
