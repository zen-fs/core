import { fs, configure, type BackendConfiguration } from '../../src/index.js';
import { Worker } from 'node:worker_threads';
import { Port } from '../../src/backends/port/fs.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

describe('Remote FS', () => {
	const port = new Worker(dirname(fileURLToPath(import.meta.url)) + '/worker.js'),
		content = 'FS is in a port';

	afterAll(() => port.terminate());

	test('configuration', async () => {
		await configure(<BackendConfiguration>{ backend: Port, port });
	});

	test('write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('read', async () => {
		expect(await fs.promises.readFile('/test', 'utf8')).toBe(content);
	});
});
