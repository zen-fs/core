import { parentPort } from 'node:worker_threads';
import { attachFS } from '../../dist/backends/port.js';
import { mounts } from '../../dist/index.js';
import { setupLogs } from '@zenfs/devel/tests/logs';

setupLogs('<remote>');

attachFS(parentPort, mounts.get('/'));
