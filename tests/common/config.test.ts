// SPDX-License-Identifier: LGPL-3.0-or-later
import { configureSingleSync, configureSync, fs, InMemory, mounts, SingleBuffer, type Backend } from '@zenfs/core';
import { Errno } from 'kerium';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

const AsyncBackend = {
	name: 'AsyncBackend',
	options: {},
	async create() {
		await Promise.resolve();
		return InMemory.create({ label: 'async-backend' });
	},
} satisfies Backend;

suite('Sync configuration', () => {
	test('configureSingleSync mounts root synchronously', () => {
		configureSingleSync({ backend: InMemory, label: 'sync-root' });
		assert.equal(mounts.get('/')?.label, 'sync-root');

		fs.writeFileSync('/sync-file', 'sync');
		assert.equal(fs.readFileSync('/sync-file', 'utf8'), 'sync');
	});

	test('configureSync mounts additional directories', () => {
		configureSync({
			mounts: {
				tmp: { backend: InMemory, label: 'sync-tmp' },
			},
		});

		assert.ok(mounts.has('/tmp'));
		fs.writeFileSync('/tmp/sync.txt', 'ok');
		assert.equal(fs.readFileSync('/tmp/sync.txt', 'utf8'), 'ok');

		fs.umount('/tmp');
		fs.rmSync('/tmp', { recursive: true, force: true });
	});

	test('configureSync rejects asynchronous backends', () => {
		assert.throws(
			() =>
				configureSync({
					mounts: { '/': { backend: AsyncBackend } },
				}),
			{ errno: Errno.EAGAIN }
		);
	});

	test('configureSingleSync works with SingleBuffer', () => {
		const buffer = new ArrayBuffer(0x20000);
		configureSingleSync({ backend: SingleBuffer, buffer });

		fs.writeFileSync('/sb.txt', 'single-buffer');
		assert.equal(fs.readFileSync('/sb.txt', 'utf8'), 'single-buffer');
	});
});
