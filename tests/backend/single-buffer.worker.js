import assert from 'node:assert';
import { writeFileSync as _write } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { configureSingle, fs, SingleBuffer } from '../../dist/index.js';
import { setupLogs } from '../logs.js';

setupLogs('<worker>');

const content = 'console.log("this file was created by the worker")';

const view = new Uint8Array(workerData);

if (process.env.DEBUG) _write('tmp/shared.bin', view);

try {
	await configureSingle({
		backend: SingleBuffer,
		buffer: workerData,
	});

	fs.writeFileSync('/worker-file.ts', content, 'utf-8');

	assert.equal(fs.readFileSync('/worker-file.ts', 'utf-8'), content);
} catch (e) {
	if (process.env.DEBUG) _write('tmp/shared.bin', view);
	console.error(e);
	parentPort.postMessage(e);
}

parentPort.postMessage('continue');
