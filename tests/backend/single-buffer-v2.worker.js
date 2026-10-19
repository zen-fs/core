import assert from 'node:assert/strict';
import { writeFileSync as _write } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { SingleBufferStore as SingleBufferStoreV2, SuperBlock } from '../../dist/backends/single_buffer/v2.js';
import { configureSingle, fs, SingleBuffer } from '../../dist/index.js';
import { setupLogs } from '../logs.js';

setupLogs('<worker>');

const { buffer, gate, mode = 'create', id = 0, count = 0 } = workerData;

try {
	if (mode != 'read') await configureSingle({ backend: SingleBuffer, buffer, v2: true });

	switch (mode) {
		case 'create': {
			const content = 'console.log("this file was created by the worker")';
			fs.writeFileSync('/worker-file.ts', content, 'utf-8');
			assert.equal(fs.readFileSync('/worker-file.ts', 'utf-8'), content);
			break;
		}
		case 'setup':
			parentPort.postMessage(Buffer.from(new SuperBlock(buffer, 0).uuid).toString('hex'));
			process.exit(0);
		case 'write':
			for (let i = 0; i < count; i++) fs.writeFileSync(`/w${id}/${i}`, `worker ${id} file ${i}`);
			break;
		case 'read': {
			const store = new SingleBufferStoreV2(buffer);
			const deadline = Date.now() + 5000;
			let reads = 0;
			while (!store.get(101) && Date.now() < deadline) {
				const data = store.get(100);
				const fill = data[0];
				assert.ok(fill && data.every(byte => byte == fill), `read a torn version (${data.length} bytes, first ${fill})`);
				if (!reads++) {
					Atomics.store(gate, 0, 1);
					Atomics.notify(gate, 0);
				}
			}
			parentPort.postMessage(reads);
			process.exit(0);
		}
	}
} catch (e) {
	if (process.env.DEBUG) _write('tmp/shared.bin', new Uint8Array(buffer));
	console.error(e);
	parentPort.postMessage(e);
}

parentPort.postMessage('continue');
