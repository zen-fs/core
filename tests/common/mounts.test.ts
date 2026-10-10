// SPDX-License-Identifier: LGPL-3.0-or-later
import { configure, fs, InMemory, mounts } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('Mounts', () => {
	test('Mount in nested directory', async () => {
		await configure({
			mounts: {
				'/nested/dir': InMemory,
			},
		});

		assert.deepEqual(fs.readdirSync('/'), ['nested']);
		assert.deepEqual(fs.readdirSync('/nested'), ['dir']);

		// cleanup
		fs.umount('/nested/dir');
		fs.rmSync('/nested', { recursive: true, force: true });
	});

	test('lstat of a mount point is the mounted root #326', async () => {
		await configure({ mounts: { '/mounted': InMemory } });

		await fs.promises.utimes('/mounted', 1, 1);
		assert.equal(fs.statSync('/mounted').mtimeMs, 1000);
		assert.equal(fs.lstatSync('/mounted').mtimeMs, 1000);
		assert.equal((await fs.promises.lstat('/mounted')).mtimeMs, 1000);

		fs.umount('/mounted');
		fs.rmdirSync('/mounted');
	});

	test('Race conditions', async () => {
		await configure({
			mounts: {
				one: InMemory,
				two: InMemory,
				three: InMemory,
				four: InMemory,
			},
		});

		assert.equal(mounts.size, 5); // 4 + default `/` mount
		assert.equal(fs.readdirSync('/').length, 4);
	});
});
