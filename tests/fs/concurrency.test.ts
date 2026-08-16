// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.ts';

suite('Concurrency', config('write', 'async'), () => {
	test('parallel writeFile in the same directory does not lose entries #256', async () => {
		await fs.promises.mkdir('/issue-256');

		await Promise.all([fs.promises.writeFile('/issue-256/a1.txt', 'a1'), fs.promises.writeFile('/issue-256/a2.txt', 'a2')]);

		const files = await fs.promises.readdir('/issue-256');
		assert.deepEqual(files.sort(), ['a1.txt', 'a2.txt']);
	});

	test('concurrent file creation does not lose directory entries #298', async () => {
		await fs.promises.mkdir('/issue-298');

		const names = Array.from({ length: 32 }, (_, i) => `file-${i}.txt`);
		await Promise.all(names.map(name => fs.promises.writeFile(`/issue-298/${name}`, name)));

		const files = await fs.promises.readdir('/issue-298');
		assert.deepEqual(files.sort(), names.sort());
	});

	test('open handles for the same file share metadata #287', async () => {
		await fs.promises.writeFile('/issue-287.txt', 'Hello World');

		const a = await fs.promises.open('/issue-287.txt', 'r+');
		const b = await fs.promises.open('/issue-287.txt', 'r+');

		await a.truncate(5); // contents are now "Hello"
		const { size } = await b.stat();
		assert.equal(size, 5);

		await a.close();
		await b.close();
	});

	test('writes are visible to other open handles before syncing', async () => {
		const a = await fs.promises.open('/shared-write.txt', 'w+');
		const b = await fs.promises.open('/shared-write.txt', 'r');

		await a.write('some shared data');

		const { buffer } = await b.read(new Uint8Array(16), 0, 16, 0);
		assert.equal(new TextDecoder().decode(buffer), 'some shared data');

		await a.close();
		await b.close();
	});

	test('reads concurrent with an overwrite of the same file do not fail #303', async () => {
		await fs.promises.writeFile('/issue-303.txt', 'original contents');

		/* Every handle for a file shares one vnode, so closing any of these flushes whatever is dirty.
		Syncing took a shared lock, letting several of these run at once and corrupt each other. */
		for (let round = 0; round < 20; round++) {
			const contents = `rewritten contents for round ${round}`;

			const results = await Promise.allSettled([
				...Array.from({ length: 4 }, () => fs.promises.readFile('/issue-303.txt', 'utf8')),
				fs.promises.writeFile('/issue-303.txt', contents),
				...Array.from({ length: 4 }, () => fs.promises.readFile('/issue-303.txt', 'utf8')),
			]);

			const rejected = results.filter(r => r.status === 'rejected');
			assert.deepEqual(
				rejected.map(r => r.reason.code ?? r.reason.message),
				[]
			);

			assert.equal(await fs.promises.readFile('/issue-303.txt', 'utf8'), contents);
		}
	});

	test('closing a handle does not fail because another handle has unsynced writes #303', async () => {
		await fs.promises.writeFile('/issue-303-close.txt', 'original');

		const reader = await fs.promises.open('/issue-303-close.txt', 'r');
		const writer = await fs.promises.open('/issue-303-close.txt', 'r+');

		// The reader wrote nothing, so its close must not report the writer's dirty data as EBUSY
		const [closed] = await Promise.allSettled([reader.close(), writer.write(new TextEncoder().encode('DIRTY'), 0, 5, 0)]);
		assert.equal(closed.status, 'fulfilled');

		await writer.close();
		assert.equal(await fs.promises.readFile('/issue-303-close.txt', 'utf8'), 'DIRTYnal');
	});

	test('concurrent recursive mkdir of overlapping trees does not fail #308', async () => {
		const paths = ['/308/a', '/308/a', '/308/a/b', '/308/a/b', '/308/c', '/308/c', '/308-2', '/308-2'];

		const results = await Promise.allSettled(paths.map(path => fs.promises.mkdir(path, { recursive: true })));

		const rejected = results.filter(r => r.status == 'rejected');
		assert.deepEqual(
			rejected.map(r => r.reason.code ?? r.reason.message),
			[]
		);

		for (const path of paths) assert((await fs.promises.stat(path)).isDirectory());
	});

	test('parallel recursive mkdir of the same path creates it once #308', async () => {
		const results = await Promise.all(Array.from({ length: 8 }, () => fs.promises.mkdir('/308-same/nested', { recursive: true })));

		assert.deepEqual(
			results.filter(result => result !== undefined),
			['/308-same']
		);
	});
});
