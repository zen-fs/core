// SPDX-License-Identifier: LGPL-3.0-or-later
import { Inode } from '@zenfs/core';
import assert from 'node:assert/strict';
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

	test('Copy to new Inode using the constructor does not alias', () => {
		const newInode = new Inode(inode);
		assert.equal(newInode.mode, inode.mode);

		newInode.mode = 0o40700;
		assert.equal(inode.mode, 0o40755);
	});
});

suite('64-bit IDs #233', () => {
	test('inodes written with 32-bit IDs read the same', () => {
		const inode = new Inode();
		const view = new DataView(inode.buffer, inode.byteOffset, inode.byteLength);
		// Offsets of the 32-bit `data` and `ino` fields in inode format 5 before 3.0
		view.setUint32(0, 0xdeadbeef, true);
		view.setUint32(58, 0x12345678, true);
		assert.equal(inode.data, 0xdeadbeefn);
		assert.equal(inode.ino, 0x12345678n);
	});

	test('IDs too large for a number survive JSON', () => {
		const inode = new Inode({ ino: 2n ** 60n, data: 3n, mode: 0o100644, nlink: 1 });
		const json = JSON.parse(JSON.stringify(inode));
		assert.equal(json.data, 3);
		assert.equal(Inode.fromJSON(json).ino, 2n ** 60n);
	});
});
