// SPDX-License-Identifier: LGPL-3.0-or-later
import { bindContext, configure, fs, InMemory } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { canary } from 'utilium';

fs.mkdirSync('/ctx');
const context = bindContext({ root: '/ctx' });
const ctx = context.fs;

suite('Context', () => {
	test('create a file', () => {
		ctx.writeFileSync('/example.txt', 'not in real root!');
		assert.deepEqual(fs.readdirSync('/'), ['ctx']);
		assert(fs.readdirSync('/ctx').includes('example.txt'));
	});

	test('linking', async () => {
		await ctx.promises.symlink('/example.txt', '/link');
		assert.equal(await ctx.promises.readlink('link', 'utf8'), '/example.txt');
		assert.equal(await fs.promises.readlink('/ctx/link'), '/example.txt');
		assert.deepEqual(await ctx.promises.readFile('/link', 'utf-8'), await fs.promises.readFile('/ctx/example.txt', 'utf-8'));

		// The symlink should only work inside the chroot /ctx
		assert.throws(() => fs.readFileSync('/ctx/link'));
	});

	test('path resolution', async () => {
		// Correct/normal
		assert.equal(ctx.realpathSync('/'), '/');
		assert.equal(ctx.realpathSync('example.txt'), '/example.txt');
		assert.equal(ctx.realpathSync('../link'), '/example.txt');
		assert.equal(await ctx.promises.realpath('/../link'), '/example.txt');

		assert.equal(fs.realpathSync('/ctx/link'), '/example.txt');
	});

	test('break-out fails', () => {
		assert.notDeepEqual(ctx.readdirSync('/../../../'), ['ctx']);
	});

	test('watch should consider context', async () => {
		let lastFile: string | null = null,
			events = 0;
		const watcher = ctx.promises.watch('/', { recursive: true });

		const silence = canary();
		const promise = (async () => {
			for await (const event of watcher) {
				lastFile = event.filename;
				if (++events == 2) return;
			}
		})();
		silence();
		await ctx.promises.writeFile('/xpto.txt', 'in real root');
		assert.equal(lastFile, 'xpto.txt');
		await ctx.promises.unlink('/xpto.txt');
		assert.equal(lastFile, 'xpto.txt');
		await watcher.return!();
		await promise;
	});

	test('Path resolution of / with context root and mount point being the same', async () => {
		// @zenfs/core#226
		await configure({
			mounts: { '/bananas': InMemory },
		});

		const bananas = bindContext({ root: '/bananas' });

		fs.writeFileSync('/bananas/yellow', 'true');

		assert.deepEqual(bananas.fs.readdirSync('/'), ['yellow']);
	});

	test('Different working directory', { todo: true }, () => {
		// @zenfs/core#263
		ctx.mkdirSync('/test');
		context.pwd = '/test';

		assert.equal(ctx.realpathSync('.'), '/test');
	});
});
