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

	test('stat and lstat of a mount point both describe the mounted root', async () => {
		await configure({ mounts: { '/mounted': InMemory } });
		fs.mkdirSync('/mounted/inside');

		// the directory underneath is not what either call reports once something is mounted there
		fs.chmodSync('/mounted', 0o1777);
		assert.equal(fs.statSync('/mounted').mode & 0o7777, 0o1777);
		assert.equal(fs.lstatSync('/mounted').mode & 0o7777, 0o1777);
		assert.equal((await fs.promises.lstat('/mounted')).mode & 0o7777, 0o1777);
		assert.equal(fs.lstatSync('/mounted').ino, fs.statSync('/mounted').ino);

		fs.rmdirSync('/mounted/inside');
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
