import assert from 'node:assert';
import { dirname } from 'node:path';
import { suite, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Port } from '../../src/backends/port/fs.js';
import { configureSingle, fs } from '../../src/index.js';

const dir = dirname(fileURLToPath(import.meta.url));

let port: Worker;

try {
	port = new Worker(dir + '/remote.worker.js');
} catch (e) {
	/* nothing */
}

await suite('Remote FS', () => {
	const content = 'FS is in a port';

	test('Build exists for worker', () => {
		assert(port);
	});

	(port ? test : test.skip)('Configuration', async () => {
		await configureSingle({ backend: Port, port, timeout: 500 });
	});

	(port ? test : test.skip)('Write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	(port ? test : test.skip)('Read', async () => {
		assert((await fs.promises.readFile('/test', 'utf8')) === content);
	});

	(port ? test : test.skip)('Cleanup', async () => {
		await port.terminate();
		port.unref();
	});
});

if (port!) {
	port.unref();
}
