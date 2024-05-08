import { InMemoryStore, configure, fs, type BackendConfiguration } from '../../src/index.js';
import { MessageChannel } from 'node:worker_threads';
import { PortStoreBackend, attachStore } from '../../src/backends/port/store.js';

describe('Store with MessageChannel', () => {
	const { port1, port2 } = new MessageChannel(),
		content = 'FS is in a port';
	let tmpstore: InMemoryStore;

	afterAll(() => {
		port1.close();
		port2.close();
	});

	test('configuration', async () => {
		tmpstore = new InMemoryStore('tmp');
		attachStore(port2, tmpstore);
		await configure(<BackendConfiguration>{
			backend: PortStoreBackend,
			port: port1,
		});
	});

	test('write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('read', async () => {
		expect(await fs.promises.readFile('/test', 'utf8')).toBe(content);
	});
});
