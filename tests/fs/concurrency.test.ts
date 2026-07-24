// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

suite('Concurrency', () => {
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
});
