// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('existsSync', () => {
	test('throws for invalid argument types', () => {
		for (const path of [undefined, null, 1, {}, true])
			assert.throws(() => fs.existsSync(path as any), { code: 'ERR_INVALID_ARG_TYPE', name: 'TypeError' });
	});
});
