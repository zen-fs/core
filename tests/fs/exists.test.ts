// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.ts';

suite('exists', () => {
	const f = 'x.txt';

	test('return true for an existing file', config('async', 'promises.exists'), async () => {
		const exists = await fs.promises.exists(f);
		assert(exists);
	});

	test('return false for a non-existent file', config('async', 'promises.exists'), async () => {
		const exists = await fs.promises.exists(f + '-NO');
		assert(!exists);
	});

	test('have sync methods that behave the same', config('sync'), () => {
		assert(fs.existsSync(f));
		assert(!fs.existsSync(f + '-NO'));
	});
});
