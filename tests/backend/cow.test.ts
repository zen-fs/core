// SPDX-License-Identifier: LGPL-3.0-or-later
import { CopyOnWriteFS, InMemoryStore, StoreFS } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { setupLogs } from '../logs.js';
setupLogs();

const size = 1 << 20;

const options = { mode: 0o644, uid: 0, gid: 0 };

suite('CopyOnWrite', () => {
	test('Truncating a base-layer file does not copy up the bytes it discards #313', async () => {
		const readable = new StoreFS(new InMemoryStore(undefined, 'ro'));
		await readable.ready();
		await readable.createFile('/big', options);
		await readable.write('/big', new Uint8Array(size).fill(0x41), 0);

		const writable = new StoreFS(new InMemoryStore(undefined, 'rw'));
		await writable.ready();

		const fs = new CopyOnWriteFS(readable, writable);
		await fs.touch('/big', { ...(await fs.stat('/big')), size: 4 });

		assert.equal((await fs.stat('/big')).size, 4);

		await using tx = writable.transaction();
		const data = (await tx.get((await writable.stat('/big')).data))!;

		assert.equal(data.byteLength, 4);
		assert.equal(data.buffer.byteLength, 4);
	});
});
