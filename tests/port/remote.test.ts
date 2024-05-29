import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Port } from '../../src/backends/port/fs.js';
import { configure, fs } from '../../src/index.js';

const dir = dirname(fileURLToPath(import.meta.url));

describe('Remote FS', () => {
	const content = 'FS is in a port';
	let port: Worker

	test('Build exists for worker', () => {
		const dist = join(dir, '..', '..', 'dist');
		expect(existsSync(dist)).toBe(true);
		port = new Worker(dir + '/worker.js');
	});

	(port ? test : test.skip)('Configuration', async () => {
		await configure({ backend: Port, port, timeout: 300 });
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
