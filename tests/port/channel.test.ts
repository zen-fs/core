import assert from 'node:assert';
import { suite, test } from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { Port, attachFS } from '../../dist/backends/port/fs.js';
import type { StoreFS } from '../../dist/index.js';
import { InMemory, configureSingle, fs, resolveMountConfig, type InMemoryStore } from '../../dist/index.js';

const { port1, port2 } = new MessageChannel(),
	content = 'FS is in a port';
let tmpfs: StoreFS<InMemoryStore>;

await suite('FS with MessageChannel', () => {
	test('configuration', async () => {
		tmpfs = await resolveMountConfig({ backend: InMemory, name: 'tmp' });
		attachFS(port2, tmpfs);
		await configureSingle({ backend: Port, port: port1, disableAsyncCache: true, timeout: 250 });
	});

	test('write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('remote content', () => {
		fs.mount('/tmp', tmpfs);
		assert(fs.readFileSync('/tmp/test', 'utf8') == content);
		fs.umount('/tmp');
	});

	test('read', async () => {
		assert((await fs.promises.readFile('/test', 'utf8')) === content);
	});

	test('readFileSync should throw', () => {
		assert.throws(() => fs.readFileSync('/test', 'utf8'), { code: 'ENOTSUP' });
	});
});

port1.unref();
port2.unref();
