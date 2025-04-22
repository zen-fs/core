import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { MessageChannel, Worker } from 'node:worker_threads';
import { Port, attachFS, waitOnline } from '../../dist/backends/port.js';
import type { InMemoryStore, StoreFS } from '../../dist/index.js';
import { InMemory, configure, configureSingle, fs, resolveMountConfig } from '../../dist/index.js';
import { setupLogs } from '../logs.js';
setupLogs();

// Tests a mis-configured `Port` using a MessageChannel

const timeoutChannel = new MessageChannel();
timeoutChannel.port2.unref();

await suite('Timeout', { timeout: 1000 }, () => {
	test('Misconfiguration', async () => {
		const configured = configure({
			mounts: {
				'/tmp-timeout': { backend: InMemory, label: 'tmp' },
				'/port': { backend: Port, port: timeoutChannel.port1, timeout: 100 },
			},
		});

		await assert.rejects(configured, { code: 'EIO', message: /RPC Failed/ });
	});

	test('Remote not attached', async () => {
		const configured = configureSingle({ backend: Port, port: timeoutChannel.port1, timeout: 100 });

		await assert.rejects(configured, { code: 'EIO', message: /RPC Failed/ });
	});
});

timeoutChannel.port1.unref();

// Test configuration

const configPort = new Worker(import.meta.dirname + '/config.worker.js');
await waitOnline(configPort);

await suite('Remote FS with resolveRemoteMount', () => {
	const content = 'FS is in a port';

	test('Configuration', async () => {
		await configureSingle({ backend: Port, port: configPort, timeout: 500 });
	});

	test('Write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('Read', async () => {
		assert.equal(await fs.promises.readFile('/test', 'utf8'), content);
	});
});

await configPort.terminate();
configPort.unref();

// Test using a message channel

const channel = new MessageChannel(),
	content = 'FS is in a port';
let tmpfs: StoreFS<InMemoryStore>;

await suite('FS with MessageChannel', () => {
	test('configuration', async () => {
		tmpfs = await resolveMountConfig({ backend: InMemory, label: 'tmp' });
		attachFS(channel.port2, tmpfs);
		await configureSingle({ backend: Port, port: channel.port1, disableAsyncCache: true, timeout: 500 });
	});

	test('write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('remote content', () => {
		fs.mount('/tmp', tmpfs);
		assert.equal(fs.readFileSync('/tmp/test', 'utf8'), content);
		fs.umount('/tmp');
	});

	test('read', async () => {
		assert.equal(await fs.promises.readFile('/test', 'utf8'), content);
	});

	test('readFileSync should throw', () => {
		assert.throws(() => fs.readFileSync('/test', 'utf8'), { code: 'ENOTSUP' });
	});
});

channel.port1.close();
channel.port2.close();
channel.port1.unref();
channel.port2.unref();

// Test using a worker

const remotePort = new Worker(import.meta.dirname + '/remote.worker.js');

await suite('Remote FS', () => {
	const content = 'FS is in a port';

	test('Configuration', async () => {
		await configureSingle({ backend: Port, port: remotePort, timeout: 500 });
	});

	test('Write', async () => {
		await fs.promises.writeFile('/test', content);
	});

	test('Read', async () => {
		assert.equal(await fs.promises.readFile('/test', 'utf8'), content);
	});
});

await remotePort.terminate();
remotePort.unref();
