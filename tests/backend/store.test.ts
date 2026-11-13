// SPDX-License-Identifier: LGPL-3.0-or-later
import { InMemoryStore, Inode, StoreFS } from '@zenfs/core';
import { S_IFDIR } from '@zenfs/core/constants';
import { setupLogs } from '@zenfs/devel/tests/logs';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
setupLogs();

const fs = new StoreFS(new InMemoryStore(0x100000, 'test'));
await fs.ready();

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

	test('writes and resizes fail instead of zero-filling missing data', async () => {
		const store = new InMemoryStore(0x100000, 'missing-data');
		const missing = new StoreFS(store);
		await missing.ready();

		await missing.createFile('/file', { mode: 0o644, uid: 0, gid: 0 });
		await missing.write('/file', encodeUTF8('hello world'), 0);
		store.delete((await missing.stat('/file')).data);

		await assert.rejects(missing.write('/file', encodeUTF8('X'), 0), { code: 'ENODATA' });
		assert.throws(() => missing.writeSync('/file', encodeUTF8('X'), 0), { code: 'ENODATA' });
		await assert.rejects(missing.touch('/file', { size: 3 }), { code: 'ENODATA' });
		assert.throws(() => missing.touchSync('/file', { size: 3 }), { code: 'ENODATA' });
		assert.equal((await missing.stat('/file')).size, 11);

		await missing.createFile('/empty', { mode: 0o644, uid: 0, gid: 0 });
		store.delete((await missing.stat('/empty')).data);
		missing.writeSync('/empty', encodeUTF8('ok'), 0);
		assert.equal((await missing.stat('/empty')).size, 2);
	});

	test('a failed operation restores what it changed', async () => {
		class FailingDelete extends InMemoryStore {
			failures = 0;

			public delete(id: bigint): boolean {
				if (this.failures-- > 0) throw new Error('delete failed');
				return super.delete(id);
			}
		}

		const store = new FailingDelete(0x100000, 'rollback');
		const rollback = new StoreFS(store);
		await rollback.ready();
		rollback.createFileSync('/file', { mode: 0o644, uid: 0, gid: 0 });

		store.failures = 1;
		assert.throws(() => rollback.unlinkSync('/file'), { message: 'delete failed' });
		assert.deepEqual(rollback.readdirSync('/'), ['file']);

		store.failures = 1;
		await assert.rejects(rollback.unlink('/file'), { message: 'delete failed' });
		assert.deepEqual(await rollback.readdir('/'), ['file']);
		assert.equal((await rollback.stat('/file')).size, 0);
	});

	test('aborting restores a key that was removed and then set again', () => {
		const original = encodeUTF8('original');
		const store = new InMemoryStore(0x100000, 'abort');
		store.set(100n, original);

		const tx = new StoreFS(store).transaction();
		tx.removeSync(100n);
		tx.setSync(100n, encodeUTF8('replacement'));
		tx.abortSync();

		assert.deepEqual(store.get(100n), original);
	});

	test('refuses JSON directory listings from before #235', async () => {
		const store = new InMemoryStore(0x100000, 'json-listing');
		const { buffer, byteOffset, byteLength } = new Inode({ ino: 0n, data: 1n, mode: S_IFDIR | 0o777, nlink: 1 });
		store.set(0n, new Uint8Array(buffer, byteOffset, byteLength));
		store.set(1n, encodeUTF8('{}'));

		await assert.rejects(new StoreFS(store).ready(), { code: 'EIO' });
		assert.throws(() => new StoreFS(store).readySync(), { code: 'EIO' });
	});
});
