// SPDX-License-Identifier: LGPL-3.0-or-later
import { Index, Inode } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

/** Build an index with `n` file entries, using IDs 2..2n+1 */
function buildIndex(n: number): Index {
	const index = new Index();
	index.set('/', new Inode({ ino: 0, data: 1, mode: 0o40755, nlink: 1 }));
	for (let i = 0; i < n; i++) {
		index.set(`/f${i}`, new Inode({ ino: 2 * i + 2, data: 2 * i + 3, mode: 0o100644, nlink: 1 }));
	}
	return index;
}

/** Calls `fn` with `depth` extra frames on the stack */
function atDepth<T>(depth: number, fn: () => T): T {
	return depth > 0 ? atDepth(depth - 1, fn) : fn();
}

suite('Index', () => {
	test('_alloc returns an unused ID', () => {
		const index = buildIndex(10);
		assert.equal(index._alloc(), 22);
	});

	test('_alloc does not re-use IDs', () => {
		const index = buildIndex(10);
		const ids = new Set<number>();

		for (let i = 0; i < 100; i++) {
			const id = index._alloc();
			assert.equal(index.getByID(id), undefined, `\`_alloc\` returned in-use ID ${id}`);
			assert(!ids.has(id), `\`_alloc\` returned duplicate ID ${id}`);
			ids.add(id);
		}
	});

	test('_alloc works with a large index #312', () => {
		const index = buildIndex(100_000);
		assert.equal(index._alloc(), 200_002);
	});

	test('_alloc works with a large index and a deep stack #312', () => {
		const index = buildIndex(60_000);
		assert.equal(
			atDepth(1000, () => index._alloc()),
			120_002
		);
	});
});
