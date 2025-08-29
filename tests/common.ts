import { join, resolve } from 'node:path';
import { fs as defaultFS } from '../dist/index.js';
import { setupLogs } from './logs.js';
import { styleText } from 'node:util';
export type * from '../dist/index.js';

setupLogs();

const setupPath = resolve(process.env.SETUP || join(import.meta.dirname, 'setup/memory.ts'));

process.on('unhandledRejection', (reason: Error) => {
	console.error('Unhandled rejection:', styleText('red', reason.stack || reason.message));
});

const setup = await import(setupPath).catch(error => {
	console.log('Failed to import test setup:');
	throw error;
});

export const fs = (setup.fs || defaultFS) as typeof defaultFS;
