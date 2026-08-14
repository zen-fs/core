// SPDX-License-Identifier: LGPL-3.0-or-later
import { parentPort, workerData } from 'node:worker_threads';
import { SuperBlock } from '../../dist/backends/single_buffer.js';
import { setupLogs } from '../logs.js';

setupLogs('<worker>');

const { buffer, gate, rotations } = workerData;

const superblock = new SuperBlock(buffer);

parentPort.postMessage('ready');

Atomics.wait(gate, 0, 0, 1000);

const offsets = [];
for (let i = 0; i < rotations; i++) offsets.push(superblock.rotateMetadata().byteOffset);

parentPort.postMessage(offsets);
