import { fs, configure, type BackendConfiguration } from '@zenfs/core';
import { Worker } from 'node:worker_threads';
import { Port } from '../src/fs.js';

describe('Remote FS', () => {
	const port = new Worker(import.meta.dirname + '/worker.js'),
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
