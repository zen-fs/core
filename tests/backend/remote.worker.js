import { parentPort } from 'node:worker_threads';
import { attachFS } from '../../dist/backends/port.js';
import { defaultContext } from '../../dist/index.js';
import { setupLogs } from '../logs.js';

setupLogs('<remote>');

attachFS(parentPort, defaultContext.mounts.get('/'));
