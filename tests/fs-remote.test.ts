import { fs, configure } from '@zenfs/core';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Port } from '../src/fs.js';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

describe('Remote FS', () => {
	const port = new Worker(__dirname + '/worker.js'),
		content = 'FS is in a port';

	afterAll(() => port.terminate());

	test('configuration', async () => {
		await configure({ backend: Port, port });
	});

	test('write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('read', async () => {
		expect(await fs.promises.readFile('/test', 'utf8')).toBe(content);
	});
});
