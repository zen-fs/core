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

	store.set(0n, inode({ ino: 0n, data: 1n, mode: S_IFDIR | 0o777, nlink: 1 }));
	store.set(1n, json({ 'file.txt': 2, dir: 4 }));
	store.set(2n, inode({ ino: 2n, data: 3n, mode: S_IFREG | 0o644, nlink: 1, size: 5 }));
	store.set(3n, encodeUTF8('hello'));
	store.set(4n, inode({ ino: 4n, data: 5n, mode: S_IFDIR | 0o755, nlink: 1 }));
	store.set(5n, json({}));
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

	test('IDs too large for a number #233', async () => {
		class LargeIdStore extends InMemoryStore {
			next = 2n ** 60n;

			allocId(): [bigint, bigint] {
				const id = this.next;
				this.next += 2n;
				return [id, id + 1n];
			}
		}

		const store = new LargeIdStore(0x100000, 'large-ids');
		const largeFS = new StoreFS(store);
		await largeFS.ready();

		await largeFS.mkdir('/dir', { mode: 0o755, uid: 0, gid: 0 });
		await largeFS.createFile('/dir/file', { mode: 0o644, uid: 0, gid: 0 });
		assert.equal((await largeFS.stat('/dir/file')).ino, 2n ** 60n + 2n);

		const remounted = new StoreFS(store);
		await remounted.ready();
		assert.deepEqual(await remounted.readdir('/dir'), ['file']);
		assert.equal((await remounted.stat('/dir/file')).ino, 2n ** 60n + 2n);
	});

	suite('Directory listing upgrade #235', () => {
		for (const sync of [false, true]) {
			test(sync ? 'readySync' : 'ready', async () => {
				const store = legacyStore();
				const legacyFS = new StoreFS(store);
				if (sync) legacyFS.readySync();
				else await legacyFS.ready();

				for (const id of [1n, 5n]) assert.notEqual(store.get(id)![0], '{'.charCodeAt(0));
				assert.deepEqual(listingTypes(store.get(1n)!), [DirType.REG, DirType.DIR]);

				assert.deepEqual(await legacyFS.readdir('/'), ['file.txt', 'dir']);
				assert.deepEqual(legacyFS.readdirSync('/dir'), []);
				assert.equal((await legacyFS.stat('/file.txt')).size, 5);

				await legacyFS.rename('/file.txt', '/dir/moved.txt');
				assert.deepEqual(await legacyFS.readdir('/dir'), ['moved.txt']);
				assert.deepEqual(listingTypes(store.get(5n)!), [DirType.REG]);
			});
		}
	});
});
