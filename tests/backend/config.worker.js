import { parentPort } from 'node:worker_threads';
import { resolveRemoteMount } from '../../dist/backends/port/fs.js';
import { InMemory } from '../../dist/backends/memory.js';
import { setupLogs } from '../logs.js';

setupLogs('<config>');

await resolveRemoteMount(parentPort, { backend: InMemory });
