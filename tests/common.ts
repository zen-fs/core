import { join, resolve } from 'node:path';
import { fs } from '../dist/index.js';

const setupPath = resolve(process.env.SETUP || join(import.meta.dirname, 'setup/memory.ts'));

await import(setupPath).catch(error => {
	console.log('Failed to import test setup:');
	throw error;
});

export { fs };
