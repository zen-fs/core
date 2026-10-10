// SPDX-License-Identifier: LGPL-3.0-or-later
import { InMemory } from '@zenfs/core';
import { withExceptionContext } from '@zenfs/core/internal/error';
import { cacheOf } from '@zenfs/core/vfs/vcache';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('VCache', () => {
	test('does not keep the exception context of the first caller', () => {
		const fs = InMemory.create({ label: 'vcache' });
		assert.equal(cacheOf(withExceptionContext(fs, { path: '/first' })).fs, fs);
	});
});
