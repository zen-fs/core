import { InMemory, fs, resolveBackendConfig } from '@zenfs/core';
import { MessageChannel } from 'node:worker_threads';
import { Port } from '../src/backend.js';
import { attach } from '../src/remote.js';

describe('MessageChannel', () => {
	const { port1, port2 } = new MessageChannel();

	afterAll(() => {
		port1.close();
		port2.close();
	});

	test('read/write', async () => {
		fs.mount('/tmp', await resolveBackendConfig({ backend: InMemory, name: 'tmp' }));
		attach(port2, fs.mounts.get('/tmp'));
		fs.mount('/port', await resolveBackendConfig({ backend: Port, port: port1 }));
		console.log('/port');

		const content = 'FS is in a port';

		await fs.promises.writeFile('/port/test', content);
		expect(fs.readFileSync('/tmp/test', 'utf8')).toBe(content);
		expect(await fs.promises.readFile('/port/test', 'utf8')).toBe(content);
	});
});
