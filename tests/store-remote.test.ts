import { configure, fs, type BackendConfiguration } from '@zenfs/core';
import { Worker } from 'node:worker_threads';
import { PortStoreBackend } from '../src/store.js';

describe('Remote Store', () => {
	const port = new Worker(import.meta.dirname + '/worker.js'),
		content = 'FS is in a port';

	afterAll(() => port.terminate());

	test('configuration', async () => {
		await configure(<BackendConfiguration>{ backend: PortStoreBackend, port });
	});

	test('write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('read', async () => {
		expect(await fs.promises.readFile('/test', 'utf8')).toBe(content);
	});
});
