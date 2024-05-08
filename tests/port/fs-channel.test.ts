import { InMemory, configure, fs, resolveMountConfig, SyncStoreFS, type BackendConfiguration } from '../../src/index.js';
import { MessageChannel } from 'node:worker_threads';
import { Port, attachFS } from '../../src/backends/port/fs.js';

describe('FS with MessageChannel', () => {
	const { port1, port2 } = new MessageChannel(),
		content = 'FS is in a port';
	let tmpfs: SyncStoreFS;

	afterAll(() => {
		port1.close();
		port2.close();
	});

	test('configuration', async () => {
		tmpfs = await resolveMountConfig({ backend: InMemory, name: 'tmp' });
		attachFS(port2, tmpfs);
		await configure(<BackendConfiguration>{ backend: Port, port: port1 });
	});

	test('write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('remote content', async () => {
		fs.mount('/tmp', tmpfs);
		expect(fs.readFileSync('/tmp/test', 'utf8')).toEqual(content);
		fs.umount('/tmp');
	});

	test('read', async () => {
		expect(await fs.promises.readFile('/test', 'utf8')).toBe(content);
	});
});
