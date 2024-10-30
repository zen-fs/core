import assert from 'node:assert';
import { dirname } from 'node:path';
import { suite, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Worker } from 'node:worker_threads';
import { Port } from '../../src/backends/port/fs.js';
import { configureSingle, fs } from '../../src/index.js';
import { createTSWorker } from '../common.js';

const dir = dirname(fileURLToPath(import.meta.url));

const port: Worker = createTSWorker(dir + '/config.worker.ts');

await suite('Remote FS with resolveRemoteMount', () => {
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
});

await port?.terminate();
port.unref();
