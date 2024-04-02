import { fs, configure } from '@zenfs/core';
import { Port } from '../src/backend.js';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

describe('Remote FS', () => {
	const port = new Worker(__dirname + '/worker.js');

	afterAll(() => port.terminate());

	test('read/write', async () => {
		await configure({ backend: Port, port });
		const content = 'FS is in a port';
		await fs.promises.writeFile('/test', content);

		const actual = await fs.promises.readFile('/test', 'utf8');
		expect(actual).toBe(content);
	});
});
