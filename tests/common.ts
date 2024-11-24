import { join, resolve } from 'node:path';
import { fs as defaultFS } from '../dist/index.js';
export type * from '../dist/emulation/index.js';

const setupPath = resolve(process.env.SETUP || join(import.meta.dirname, 'setup/memory.ts'));

const setup = await import(setupPath).catch(error => {
	console.log('Failed to import test setup:');
	throw error;
});

export const fs = (setup.fs || defaultFS) as typeof defaultFS;
