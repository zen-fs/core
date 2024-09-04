import { dirname } from 'node:path';
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

describe('Remote FS', () => {
	const content = 'FS is in a port';

	test('Build exists for worker', () => {
		expect(port).toBeDefined();
	});

	(port ? test : test.skip)('Configuration', async () => {
		await configureSingle({ backend: Port, port, timeout: 500 });
	});

	(port ? test : test.skip)('Write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	(port ? test : test.skip)('Read', async () => {
		expect(await fs.promises.readFile('/test', 'utf8')).toBe(content);
	});

	(port ? test : test.skip)('Cleanup', async () => {
		await port.terminate();
		port.unref();
	});
});
