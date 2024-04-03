import { InMemory, fs, resolveBackend, type SyncStoreFS, type InMemoryStore } from '@zenfs/core';
import { MessageChannel } from 'node:worker_threads';
import { PortStoreBackend, attachStore } from '../src/store.js';

describe('Store with MessageChannel', () => {
	const { port1, port2 } = new MessageChannel();

	afterAll(() => {
		port1.close();
		port2.close();
	});

	test('read/write', async () => {
		const tmpfs = (await resolveBackend({ backend: InMemory, name: 'tmp' })) as SyncStoreFS & { store: InMemoryStore };
		fs.mount('/tmp', tmpfs);
		attachStore(port2, tmpfs.store);
		fs.mount('/port', await resolveBackend({ backend: PortStoreBackend, port: port1 }));

		const content = 'FS is in a port';

		await fs.promises.writeFile('/port/test', content);
		expect(fs.readFileSync('/tmp/test', 'utf8')).toBe(content);
		const actual = await fs.promises.readFile('/port/test', 'utf8');
		expect(actual).toBe(content);
	});
});
