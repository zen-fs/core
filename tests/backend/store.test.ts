// SPDX-License-Identifier: LGPL-3.0-or-later
import { InMemoryStore, StoreFS } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { setupLogs } from '../logs.js';
setupLogs();

const fs = new StoreFS(new InMemoryStore(0x100000, 'test'));
await fs.ready();

const encoder = new TextEncoder();

suite('StoreFS', () => {
	test('write updates inode metadata atomically #286', async () => {
		await fs.createFile('/example.json', { mode: 0o644, uid: 0, gid: 0 });
		const before = await fs.stat('/example.json');

		// Write without a following touch(), like an interrupted VFS flush
		const data = encoder.encode('{"json":true}');
		await fs.write('/example.json', data, 0);

		const after = await fs.stat('/example.json');
		assert.equal(after.size, data.byteLength);
		assert(after.mtimeMs >= before.mtimeMs);
	});

	test('writeSync updates inode metadata atomically #286', () => {
		fs.createFileSync('/example-sync.json', { mode: 0o644, uid: 0, gid: 0 });

		const data = encoder.encode('{"sync":true}');
		fs.writeSync('/example-sync.json', data, 0);

		const stats = fs.statSync('/example-sync.json');
		assert.equal(stats.size, data.byteLength);
	});

	test('write does not resurrect truncated data', async () => {
		await fs.createFile('/truncated.txt', { mode: 0o644, uid: 0, gid: 0 });

		await fs.write('/truncated.txt', encoder.encode('a'.repeat(100)), 0);
		await fs.touch('/truncated.txt', { size: 5 });

		// A small write within the truncated size must not restore the old length from the data blob
		await fs.write('/truncated.txt', encoder.encode('bbb'), 0);

		const stats = await fs.stat('/truncated.txt');
		assert.equal(stats.size, 5);
	});
});
