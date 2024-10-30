import assert from 'node:assert';
import { suite, test } from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { Port } from '../../dist/backends/port/fs.js';
import { ErrnoError, InMemory, configure, configureSingle, fs } from '../../dist/index.js';

/**
 * Tests a mis-configured PortFS using a MessageChannel
 */

const { port1, port2 } = new MessageChannel();
port2.unref();

await suite('Timeout', { timeout: 1000 }, () => {
	test('Misconfiguration', async () => {
		let error: ErrnoError;
		try {
			await configure({
				mounts: {
					'/tmp': { backend: InMemory, name: 'tmp' },
					'/port': { backend: Port, port: port1, timeout: 100 },
				},
			});
		} catch (e) {
			assert(e instanceof ErrnoError);
			error = e;
		}
		assert(error! instanceof ErrnoError);
		assert(error.code === 'EIO');
		assert(error.message.includes('RPC Failed'));
	});

	test('Remote not attached', async () => {
		let error: ErrnoError;
		try {
			await configureSingle({ backend: Port, port: port1, timeout: 100 });
			await fs.promises.writeFile('/test', 'anything');
		} catch (e) {
			assert(e instanceof ErrnoError);
			error = e;
		}
		assert(error! instanceof ErrnoError);
		assert(error.code === 'EIO');
		assert(error.message.includes('RPC Failed'));
	});
});

port1.unref();
