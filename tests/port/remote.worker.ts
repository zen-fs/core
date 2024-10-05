import { parentPort } from 'node:worker_threads';
import { attachFS } from '../../src/backends/port/fs.js';
import { mounts } from '../../src/index.js';

attachFS(parentPort!, mounts.get('/')!);
