import { parentPort } from 'node:worker_threads';
import { resolveRemoteMount } from '../../dist/backends/port.js';
import { InMemory } from '../../dist/backends/memory.js';
import { setupLogs } from '@zenfs/devel/tests/logs';

setupLogs('<config>');

await resolveRemoteMount(parentPort, { backend: InMemory });
