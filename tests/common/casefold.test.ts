// SPDX-License-Identifier: LGPL-3.0-or-later
import { configure, fs, mounts } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('Case folding', () => {
	test('Configuration', async () => {
		await configure({ caseFold: 'lower' });
		assert.equal(mounts.get('/')?.attributes.get('case_fold'), 'lower');
	});

	test('Write', () => {
		fs.writeFileSync('/Test.txt', 'test');
		assert(fs.existsSync('/test.txt'));
	});

	test('Read', () => {
		assert.equal(fs.readFileSync('/TEST.txt', 'utf8'), 'test');
	});
});
