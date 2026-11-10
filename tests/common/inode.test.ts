// SPDX-License-Identifier: LGPL-3.0-or-later
import { Inode } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';

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

	test('Views are copied and ArrayBuffers are not', () => {
		const bytes = new Uint8Array(inode.buffer, inode.byteOffset, inode.byteLength).slice();

		const copy = new Inode(bytes);
		copy.mode = 0o100600;
		assert.equal(new Inode(bytes).mode, 0o40755);

		const alias = new Inode(bytes.buffer);
		alias.mode = 0o100600;
		assert.equal(new Inode(bytes).mode, 0o100600);
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

suite('Attributes', () => {
	test('getOrInsert and getOrInsertComputed only insert missing attributes', () => {
		const { attributes } = new Inode();
		attributes.set('user.a', encodeUTF8('a'));

		assert.deepEqual(attributes.getOrInsert('user.a', encodeUTF8('other')), encodeUTF8('a'));
		assert.deepEqual(attributes.getOrInsert('user.b', encodeUTF8('b')), encodeUTF8('b'));

		let calls = 0;
		const compute = (name: string) => (calls++, encodeUTF8(name));
		assert.deepEqual(attributes.getOrInsertComputed('user.a', compute), encodeUTF8('a'));
		assert.deepEqual(attributes.getOrInsertComputed('user.c', compute), encodeUTF8('user.c'));
		assert.equal(calls, 1);
		assert.equal(attributes.size, 3);
	});

	test('forEach and clear', () => {
		const { attributes } = new Inode();
		attributes.set('user.a', encodeUTF8('1'));
		attributes.set('user.b', encodeUTF8('2'));

		const seen: [string, string][] = [];
		attributes.forEach((value, name, map) => {
			assert.equal(map, attributes);
			seen.push([name, new TextDecoder().decode(value)]);
		});
		assert.deepEqual(seen, [
			['user.a', '1'],
			['user.b', '2'],
		]);

		attributes.clear();
		assert.equal(attributes.size, 0);
		assert.equal(attributes.get('user.a'), undefined);
	});

	test('copying nearly full attributes', () => {
		const source = new Inode();
		source.attributes.set('user.big', new Uint8Array(3900).fill(7));

		const copy = new Inode();
		copy.update({ attributes: source.attributes });
		assert.deepEqual(copy.attributes.get('user.big'), source.attributes.get('user.big'));
	});

	test('copying shorter attributes clears the rest', () => {
		const copy = new Inode();
		copy.attributes.set('user.long', new Uint8Array(200).fill(9));

		const source = new Inode();
		source.attributes.set('user.a', encodeUTF8('a'));
		copy.update({ attributes: source.attributes });

		copy.attributes.set('user.b', encodeUTF8('b'));
		assert.deepEqual(Array.from(copy.attributes.keys()), ['user.a', 'user.b']);
	});
});
