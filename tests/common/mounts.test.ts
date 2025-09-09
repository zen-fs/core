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
