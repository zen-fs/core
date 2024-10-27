import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fs } from '../src/index.js';

/**
 * Creates a Typescript Worker
 * @see https://github.com/privatenumber/tsx/issues/354
 * @see https://github.com/nodejs/node/issues/47747#issuecomment-2287745567
 */
export function createTSWorker(source: string): Worker {
	return new Worker(`import('tsx/esm/api').then(tsx => {tsx.register();import('${source}');});`, { eval: true });
}

const setupPath = resolve(process.env.SETUP || join(import.meta.dirname, 'setup/InMemory.ts'));

await import(setupPath).catch(error => {
	console.log('Failed to import test setup:');
	throw error;
});

export { fs };
