import { suite, test } from 'node:test';
import { Inode } from '../../dist/internal/inode.js';
import assert from 'node:assert';

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
