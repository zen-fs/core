import { InMemory, fs, resolveBackend } from '@zenfs/core';
import { MessageChannel } from 'node:worker_threads';
import { Port, attachFS } from '../src/fs.js';

describe('FS with MessageChannel', () => {
	const { port1, port2 } = new MessageChannel();

	afterAll(() => {
		port1.close();
		port2.close();
	});

	test('read/write', async () => {
		fs.mount('/tmp', await resolveBackend({ backend: InMemory, name: 'tmp' }));
		attachFS(port2, fs.mounts.get('/tmp'));
		fs.mount('/port', await resolveBackend({ backend: Port, port: port1 }));

		const content = 'FS is in a port';

		await fs.promises.writeFile('/port/test', content);
		expect(fs.readFileSync('/tmp/test', 'utf8')).toBe(content);
		const actual = await fs.promises.readFile('/port/test', 'utf8');
		expect(actual).toBe(content);
	});
});
