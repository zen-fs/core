// SPDX-License-Identifier: LGPL-3.0-or-later
import { Async, InMemory, InMemoryStore, StoreFS } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

class AsyncMemory extends Async(StoreFS) {
	_sync = InMemory.create({ label: 'sync' });
}

suite('Async()', () => {
	test('sync operations are applied to the sync cache once', async () => {
		const fs = new AsyncMemory(new InMemoryStore());
		fs.checkRootSync();
		await fs.ready();

		const calls: string[] = [];
		for (const key of ['mkdirSync', 'rmdirSync', 'createFileSync', 'unlinkSync'] as const) {
			const original = (fs._sync[key] as (...args: unknown[]) => unknown).bind(fs._sync);
			(fs._sync as any)[key] = (...args: unknown[]) => {
				calls.push(key);
				return original(...args);
			};
		}

		const options = { mode: 0o755, uid: 0, gid: 0 };
		fs.mkdirSync('/dir', options);
		fs.rmdirSync('/dir');
		fs.createFileSync('/file', options);
		fs.unlinkSync('/file');
		await new Promise(resolve => setTimeout(resolve));

		assert.deepEqual(calls, ['mkdirSync', 'rmdirSync', 'createFileSync', 'unlinkSync']);
		assert.deepEqual(await fs.readdir('/'), []);
	});
});
