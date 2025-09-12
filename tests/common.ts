// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs as defaultFS } from '@zenfs/core';
import type { NodeFS } from '@zenfs/core/node/types.js';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { setupLogs } from './logs.js';

setupLogs();

const setupPath = resolve(process.env.SETUP || join(import.meta.dirname, 'setup/memory.ts'));

process.on('unhandledRejection', (reason: Error) => {
	console.error('Unhandled rejection:', styleText('red', reason.stack || reason.message));
});

const setup = await import(setupPath).catch(error => {
	console.log('Failed to import test setup:');
	throw error;
});

// Satisfies is used to make sure that ZenFS is fully type compatible with Node.js
export const fs = (setup.fs || defaultFS) as typeof defaultFS satisfies NodeFS;
