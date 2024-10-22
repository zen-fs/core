import { parentPort } from 'node:worker_threads';
import { attachFS } from '../../src/backends/port/fs.ts';
import { mounts } from '../../src/index.ts';

attachFS(parentPort!, mounts.get('/')!);
