import { configure, fs } from '@zenfs/core';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { PortStoreBackend } from '../src/store.js';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

describe('Remote Store', () => {
	const port = new Worker(__dirname + '/worker.js'),
		content = 'FS is in a port';

	afterAll(() => port.terminate());

	test('configuration', async () => {
		await configure({ backend: PortStoreBackend, port });
	});

	test('write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('read', async () => {
		expect(await fs.promises.readFile('/test', 'utf8')).toBe(content);
	});
});
