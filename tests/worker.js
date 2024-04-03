import { InMemory, fs, resolveBackend } from '@zenfs/core';
import { parentPort } from 'node:worker_threads';
import { attachFS } from '../dist/fs.js';
import { attachStore } from '../dist/store.js';

attachFS(parentPort, fs.mounts.get('/'));
const tmpfs = await resolveBackend({ backend: InMemory, name: 'tmp' });
fs.mount('/tmp', tmpfs);
attachStore(parentPort, tmpfs.store);
