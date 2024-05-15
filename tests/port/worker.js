import { parentPort } from 'node:worker_threads';
import { attachFS } from '../../dist/backends/port/fs.js';
import { fs } from '../../dist/index.js';

attachFS(parentPort, fs.mounts.get('/'));
