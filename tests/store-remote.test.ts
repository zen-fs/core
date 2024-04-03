import { fs, configure } from '@zenfs/core';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortStoreBackend } from '../src/store.js';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

describe('Remote Store', () => {
	const port = new Worker(__dirname + '/worker.js');

	afterAll(() => port.terminate());

	test('read/write', async () => {
		await configure({ backend: PortStoreBackend, port });
		const content = 'FS is in a port';
		await fs.promises.writeFile('/test', content);

		const actual = await fs.promises.readFile('/test', 'utf8');
		expect(actual).toBe(content);
	});
});
