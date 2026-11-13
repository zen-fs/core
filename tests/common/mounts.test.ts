// SPDX-License-Identifier: LGPL-3.0-or-later
import { Async, configure, defaultContext, fs, InMemory, InMemoryStore, Readonly, StoreFS, sync } from '@zenfs/core';
import { withErrno } from 'kerium';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { decodeUTF8 } from 'utilium';

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
		await fs.umount('/nested/dir');
		fs.rmSync('/nested', { recursive: true, force: true });
	});

	test('lstat of a mount point is the mounted root #326', async () => {
		await configure({ mounts: { '/mounted': InMemory } });

		await fs.promises.utimes('/mounted', 1, 1);
		assert.equal(fs.statSync('/mounted').mtimeMs, 1000);
		assert.equal(fs.lstatSync('/mounted').mtimeMs, 1000);
		assert.equal((await fs.promises.lstat('/mounted')).mtimeMs, 1000);

		await fs.umount('/mounted');
		fs.rmdirSync('/mounted');
	});

	test('sync writes cached changes to the file system', async () => {
		await configure({ mounts: { '/synced': InMemory } });
		const backend = defaultContext.mounts.get('/synced')!;

		await using handle = await fs.promises.open('/synced/file', 'w');
		await handle.write('hello');
		const backendData = () => {
			const data = new Uint8Array(5);
			backend.readSync('/file', data, 0, 5);
			return decodeUTF8(data);
		};
		assert.notEqual(backendData(), 'hello');

		await sync();
		assert.equal(backendData(), 'hello');

		await handle.close();
		await fs.umount('/synced');
		fs.rmdirSync('/synced');
	});

	test('umount waits for queued writes and still unmounts if they fail', async () => {
		let attempted = false;
		class FailingWrites extends Async(StoreFS) {
			_sync = InMemory.create({ label: 'sync' });
			public async write(): Promise<void> {
				await setTimeout(5);
				attempted = true;
				throw new Error('backend write failed');
			}
		}

		const failing = new FailingWrites(new InMemoryStore());
		failing.checkRootSync();
		await failing.ready();
		fs.mkdirSync('/failing');
		fs.mount('/failing', failing);

		fs.writeFileSync('/failing/file', 'data');

		await fs.umount('/failing');
		assert(attempted);
		assert(!defaultContext.mounts.has('/failing'));
		fs.rmdirSync('/failing');
	});

	test('read-only file systems can be synced and unmounted', async () => {
		class ReadonlyMemory extends Readonly(StoreFS) {}

		const store = new InMemoryStore();
		new StoreFS(store).checkRootSync();
		fs.mkdirSync('/readonly');
		fs.mount('/readonly', new ReadonlyMemory(store));

		await sync();
		await fs.umount('/readonly');
		fs.mkdirSync('/readonly-sync');
		fs.mount('/readonly-sync', new ReadonlyMemory(store));
		fs.umountSync('/readonly-sync');

		fs.rmdirSync('/readonly');
		fs.rmdirSync('/readonly-sync');
	});

	test('umountSync logs a failed background flush instead of rejecting', async () => {
		class AsyncOnly extends StoreFS {
			public writeSync(): void {
				throw withErrno('EAGAIN');
			}
			public write(): Promise<void> {
				return Promise.reject(new Error('backend write failed'));
			}
		}

		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);

		const asyncOnly = new AsyncOnly(new InMemoryStore());
		asyncOnly.checkRootSync();
		fs.mkdirSync('/async-only');
		fs.mount('/async-only', asyncOnly);

		const handle = await fs.promises.open('/async-only/file', 'w');
		await handle.write('data');
		fs.umountSync('/async-only');
		assert(!defaultContext.mounts.has('/async-only'));

		await setTimeout(10);
		process.off('unhandledRejection', onUnhandled);
		assert.deepEqual(unhandled, []);
		fs.rmdirSync('/async-only');
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

		assert.equal(defaultContext.mounts.size, 5); // 4 + default `/` mount
		assert.equal(fs.readdirSync('/').length, 4);
	});
});
