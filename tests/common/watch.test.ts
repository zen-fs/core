// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

fs.mkdirSync('/watch-queue');
fs.writeFileSync('/watch-queue/queued', '');

suite('promises.watch queue', () => {
	test('events are queued until they are consumed', { timeout: 1000 }, async () => {
		await using watcher = fs.promises.watch('/watch-queue/queued');
		for (let i = 0; i < 3; i++) fs.writeFileSync('/watch-queue/queued', String(i));

		for (let i = 0; i < 3; i++) assert.equal((await watcher.next()).value?.filename, 'queued');
	});

	test('overflow error rejects once maxQueue is exceeded', { timeout: 1000 }, async () => {
		const watcher = fs.promises.watch('/watch-queue', { maxQueue: 1, overflow: 'error' as any });
		for (let i = 0; i < 3; i++) fs.writeFileSync(`/watch-queue/overflow${i}`, '');

		await assert.rejects(watcher.next(), { code: 'ERR_FS_WATCH_QUEUE_OVERFLOW' });
		assert.deepEqual(await watcher.next(), { value: undefined, done: true });
	});
});
