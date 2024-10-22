import { parentPort } from 'node:worker_threads';
import { InMemory } from '../../src/backends/memory.ts';
import { resolveRemoteMount } from '../../src/backends/port/fs.ts';

await resolveRemoteMount(parentPort!, { backend: InMemory });
