// SPDX-License-Identifier: LGPL-3.0-or-later
import { Index, Inode } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

/** Build an index with `n` file entries, using IDs 2..2n+1 */
function buildIndex(n: number): Index {
	const index = new Index();
	index.set('/', new Inode({ ino: 0n, data: 1n, mode: 0o40755, nlink: 1 }));
	for (let i = 0; i < n; i++) {
		const ino = BigInt(2 * i + 2);
		index.set(`/f${i}`, new Inode({ ino, data: ino + 1n, mode: 0o100644, nlink: 1 }));
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
		assert.equal(index._alloc(), 22n);
	});

	test('_alloc does not re-use IDs', () => {
		const index = buildIndex(10);
		const ids = new Set<bigint>();

		for (let i = 0; i < 100; i++) {
			const id = index._alloc();
			assert.equal(index.getByID(id), undefined, `\`_alloc\` returned in-use ID ${id}`);
			assert(!ids.has(id), `\`_alloc\` returned duplicate ID ${id}`);
			ids.add(id);
		}
	});

	test('loads indexes with numeric IDs #233', () => {
		const index = Index.parse(
			JSON.stringify({
				version: 1,
				entries: {
					'/': { ino: 7, mode: 0o40755, nlink: 1 },
					'/file': { ino: 5, data: 6, mode: 0o100644, nlink: 1 },
				},
			}),
		);
		assert.equal(index.get('/')!.ino, 0n);
		assert.equal(index.get('/file')!.ino, 5n);
		assert.equal(index.get('/file')!.data, 6n);
		assert.equal(index.toJSON().entries['/file'].ino, 5);
	});

	test('_alloc works with a large index #312', () => {
		const index = buildIndex(100_000);
		assert.equal(index._alloc(), 200_002n);
	});

	test('_alloc works with a large index and a deep stack #312', () => {
		const index = buildIndex(60_000);
		assert.equal(
			atDepth(1000, () => index._alloc()),
			120_002n,
		);
	});
});
