import { InMemory, fs, resolveMountConfig } from '../../dist/index.js';
import { parentPort } from 'node:worker_threads';
import { attachFS } from '../../dist/backends/port/fs.js';
import { attachStore } from '../../dist/backends/port/store.js';

attachFS(parentPort, fs.mounts.get('/'));
const tmpfs = await resolveMountConfig({ backend: InMemory, name: 'tmp' });
fs.mount('/tmp', tmpfs);
attachStore(parentPort, tmpfs.store);
