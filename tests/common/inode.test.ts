// SPDX-License-Identifier: LGPL-3.0-or-later
import { Inode } from '@zenfs/core';
import assert from 'node:assert';
import { suite, test } from 'node:test';

suite('Inode manipulation', () => {
	const inode = new Inode();
	inode.mode = 0o40755;
	assert.equal(inode.mode, 0o40755);

	test('Copy to new Inode using constructor and spread', () => {
		const newInode = new Inode({ ...inode });
		assert.equal(newInode.mode, inode.mode);
	});

	test('Copy to new Inode using Object.assign', () => {
		const newInode = Object.assign(new Inode(), inode);
		assert.equal(newInode.mode, inode.mode);
	});
});
