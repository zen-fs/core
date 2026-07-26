// SPDX-License-Identifier: LGPL-3.0-or-later
import { CopyOnWrite, Fetch, InMemory, configureSingle, fs, mounts, resolveMountConfig, type FetchFS } from '@zenfs/core';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { baseUrl, defaultEntries, indexPath, whenServerReady } from '../fetch/config.js';
import { setupLogs } from '../logs.js';

setupLogs();

const server = new Worker(join(import.meta.dirname, '../fetch/server.js'));

await whenServerReady();

await configureSingle({
	backend: Fetch,
	disableAsyncCache: true,
	remoteWrite: true,
	baseUrl,
	index: baseUrl + indexPath,
});

suite('Fetch with `disableAsyncCache`', () => {
	test('Read and write file', async () => {
		await fs.promises.writeFile('/example', 'test');

		const contents = await fs.promises.readFile('/example', 'utf8');

		assert.equal(contents, 'test');
	});

	test('Make new directory', async () => {
		await fs.promises.mkdir('/duck');
		const stats = await fs.promises.stat('/duck');
		assert(stats.isDirectory());
	});

	test('Read directory', async () => {
		const entries = await fs.promises.readdir('/');

		assert.deepEqual(entries, [...defaultEntries, 'example', 'duck']);
	});

	test('Uncached synchronous operations throw', () => {
		assert.throws(() => fs.readFileSync('/x.txt', 'utf8'), { code: 'EAGAIN' });
	});
});

suite('CopyOnWrite over uncached Fetch #301', () => {
	test('Overwriting a base-layer file does not need a synchronous copy-up read', async () => {
		const readable = await resolveMountConfig({ backend: Fetch, disableAsyncCache: true, baseUrl, index: baseUrl + indexPath });

		fs.mount('/cow', await resolveMountConfig({ backend: CopyOnWrite, readable, writable: InMemory.create({}) }));

		// `w+` truncates first, so none of the base file survives and nothing has to be read from it
		fs.writeFileSync('/cow/49chars.txt', 'replaced');

		assert.equal(fs.readFileSync('/cow/49chars.txt', 'utf8'), 'replaced');
		assert.equal(fs.statSync('/cow/49chars.txt').size, 8);
	});

	test('Partially overwriting an uncached base-layer file still throws', () => {
		const fd = fs.openSync('/cow/a.js', 'r+');
		fs.writeSync(fd, 'x', 0);

		// The bytes the write leaves alone have to be copied up, which `Fetch` can not do synchronously.
		// Writes go through the vnode cache, so this surfaces when the handle is flushed rather than at `write`.
		assert.throws(() => fs.fsyncSync(fd), { code: 'EAGAIN' });
	});
});

after(async () => {
	await (mounts.get('/') as FetchFS)._asyncDone;
	await server.terminate();
	server.unref();
});
