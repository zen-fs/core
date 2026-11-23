// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('opendir', () => {
	test('opendir throws for an invalid bufferSize instead of calling back', () => {
		let called = false;
		assert.throws(() => fs.opendir('/', { bufferSize: 0 }, () => (called = true)), { code: 'ERR_OUT_OF_RANGE' });
		assert(!called);
	});

	test('promises.opendir rejects for an invalid bufferSize', async () => {
		const result = fs.promises.opendir('/', { bufferSize: 0 });
		assert(result instanceof Promise);
		await assert.rejects(result, { code: 'ERR_OUT_OF_RANGE' });
	});
});
