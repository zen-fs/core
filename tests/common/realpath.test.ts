// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('realpath', () => {
	test('resolves .. in a symlink target against the resolved parent', async () => {
		fs.mkdirSync('/realpath/a/b/c', { recursive: true });
		fs.mkdirSync('/realpath/a/b/d');
		fs.symlinkSync('a/b/c', '/realpath/c');
		fs.symlinkSync('c/../d', '/realpath/d');

		assert.equal(fs.realpathSync('/realpath/d'), '/realpath/a/b/d');
		assert.equal(await fs.promises.realpath('/realpath/d'), '/realpath/a/b/d');
	});
});
