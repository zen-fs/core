import { parentPort } from 'node:worker_threads';
import { resolveRemoteMount } from '../../src/backends/port/fs.js';
import { InMemory } from '../../src/backends/memory.js';

await resolveRemoteMount(parentPort!, { backend: InMemory });
