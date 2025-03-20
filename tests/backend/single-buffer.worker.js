import { parentPort, workerData } from 'node:worker_threads';
import { configureSingle, fs, SingleBuffer } from '../../dist/index.js';

await configureSingle({
	backend: SingleBuffer,
	buffer: workerData,
});

fs.writeFileSync('/worker-file.ts', 'console.log("this file was created by the worker")', 'utf-8');

parentPort.postMessage('continue');
