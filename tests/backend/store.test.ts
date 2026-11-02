// SPDX-License-Identifier: LGPL-3.0-or-later
import { InMemoryStore, Inode, StoreFS, type InodeLike } from '@zenfs/core';
import { S_IFDIR, S_IFREG } from '@zenfs/core/constants';
import { DirType } from '@zenfs/core/vfs/dir';
import { setupLogs } from '@zenfs/devel/tests/logs';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
setupLogs();

const fs = new StoreFS(new InMemoryStore(0x100000, 'test'));
await fs.ready();

/** Creates a store with JSON directory listings, as written by versions before #235 */
function legacyStore(): InMemoryStore {
	const store = new InMemoryStore(0x100000, 'legacy');
	const json = (listing: Record<string, number>) => encodeUTF8(JSON.stringify(listing));
	const inode = (init: Partial<InodeLike>) => {
		const { buffer, byteOffset, byteLength } = new Inode(init);
		return new Uint8Array(buffer, byteOffset, byteLength);
	};

	store.set(0, inode({ ino: 0, data: 1, mode: S_IFDIR | 0o777, nlink: 1 }));
	store.set(1, json({ 'file.txt': 2, dir: 4 }));
	store.set(2, inode({ ino: 2, data: 3, mode: S_IFREG | 0o644, nlink: 1, size: 5 }));
	store.set(3, encodeUTF8('hello'));
	store.set(4, inode({ ino: 4, data: 5, mode: S_IFDIR | 0o755, nlink: 1 }));
	store.set(5, json({}));
	return store;
}

/** Reads the type of each entry of a binary directory listing */
function listingTypes(data: Uint8Array): number[] {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const types = [];
	for (let i = 0, offset = 5; i < view.getUint32(1, true); i++) {
		types.push(view.getUint8(offset + 8));
		offset += 11 + view.getUint16(offset + 9, true);
	}
	return types;
}

suite('StoreFS', () => {
	test('write updates inode metadata atomically #286', async () => {
		await fs.createFile('/example.json', { mode: 0o644, uid: 0, gid: 0 });
		const before = await fs.stat('/example.json');

		// Write without a following touch(), like an interrupted VFS flush
		const data = encodeUTF8('{"json":true}');
		await fs.write('/example.json', data, 0);

		const after = await fs.stat('/example.json');
		assert.equal(after.size, data.byteLength);
		assert(after.mtimeMs >= before.mtimeMs);
	});

	test('writeSync updates inode metadata atomically #286', () => {
		fs.createFileSync('/example-sync.json', { mode: 0o644, uid: 0, gid: 0 });

		const data = encodeUTF8('{"sync":true}');
		fs.writeSync('/example-sync.json', data, 0);

		const stats = fs.statSync('/example-sync.json');
		assert.equal(stats.size, data.byteLength);
	});

	test('write does not resurrect truncated data', async () => {
		await fs.createFile('/truncated.txt', { mode: 0o644, uid: 0, gid: 0 });

		await fs.write('/truncated.txt', encodeUTF8('a'.repeat(100)), 0);
		await fs.touch('/truncated.txt', { size: 5 });

		// A small write within the truncated size must not restore the old length from the data blob
		await fs.write('/truncated.txt', encodeUTF8('bbb'), 0);

		const stats = await fs.stat('/truncated.txt');
		assert.equal(stats.size, 5);
	});

	suite('Directory listing upgrade #235', () => {
		for (const sync of [false, true]) {
			test(sync ? 'readySync' : 'ready', async () => {
				const store = legacyStore();
				const legacyFS = new StoreFS(store);
				if (sync) legacyFS.readySync();
				else await legacyFS.ready();

				for (const id of [1, 5]) assert.notEqual(store.get(id)![0], '{'.charCodeAt(0));
				assert.deepEqual(listingTypes(store.get(1)!), [DirType.REG, DirType.DIR]);

				assert.deepEqual(await legacyFS.readdir('/'), ['file.txt', 'dir']);
				assert.deepEqual(legacyFS.readdirSync('/dir'), []);
				assert.equal((await legacyFS.stat('/file.txt')).size, 5);

				await legacyFS.rename('/file.txt', '/dir/moved.txt');
				assert.deepEqual(await legacyFS.readdir('/dir'), ['moved.txt']);
				assert.deepEqual(listingTypes(store.get(5)!), [DirType.REG]);
			});
		}
	});
});
