// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs as defaultFS } from '@zenfs/core';
import type { NodeFS } from '@zenfs/core/node/types';
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

/**
 * A feature or function a backend may not support.
 * Tests that need one are skipped when the backend under test does not have it.
 */
export type TestFlag =
	| 'sync'
	| 'async'
	| 'write'
	| 'appends'
	| 'directories'
	| 'links'
	| 'symlinks'
	| 'rename'
	| 'truncate'
	| 'streams'
	| 'watch'
	| 'permissions'
	| 'xattr'
	| 'times'
	| 'tempdir'
	| 'lchmod'
	| 'promises.exists'
	| 'root';

/**
 * Whether a backend supports a flag.
 *
 * `false` is for things a backend can not support, while `'skip'` is for temporarily disabling something.
 * `'todo'` is for things that should work but don't yet.
 */
export type TestFlagState = boolean | 'skip' | 'todo';

/** Flags are supported unless the setup says otherwise */
const flags = (setup.flags ?? {}) as Partial<Record<TestFlag, TestFlagState>>;

/** Options for `suite` and `test`. Note this is a subset of both, since they do not share a type. */
export interface TestConfig {
	skip?: string;
	todo?: string;
}

/**
 * Configures a `suite` or `test` to run only if the backend supports all of the given flags.
 *
 * @example
 * ```ts
 * test('lchmod', config('lchmod', 'async'), async () => { ... });
 * ```
 */
export function config(...required: TestFlag[]): TestConfig {
	for (const flag of required) {
		const state = flags[flag] ?? true;

		if (state === true) continue;
		if (state == 'todo') return { todo: `${flag} is not implemented yet` };

		return { skip: state == 'skip' ? `${flag} is temporarily skipped` : `${flag} is not supported` };
	}

	return {};
}
