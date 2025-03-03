import { parentPort } from 'node:worker_threads';
import { attachFS } from '../../dist/backends/port/fs.js';
import { mounts } from '../../dist/index.js';
import { setupLogs } from '../logs.js';

setupLogs('<remote>');

attachFS(parentPort, mounts.get('/'));
