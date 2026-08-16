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

	test('Path resolution of / with context root and mount point being the same #226', async () => {
		await configure({
			mounts: { '/bananas': InMemory },
		});

		const bananas = bindContext({ root: '/bananas' });

		fs.writeFileSync('/bananas/yellow', 'true');

		assert.deepEqual(bananas.fs.readdirSync('/'), ['yellow']);
	});

	test('Different working directory #263', () => {
		ctx.mkdirSync('/test');
		context.pwd = '/test';

		assert.equal(ctx.realpathSync('.'), '/test');
	});

	test('globSync should keep the context', () => {
		ctx.mkdirSync('/globbed');
		ctx.writeFileSync('/globbed/inside.txt', 'in the context');

		fs.mkdirSync('/globbed');
		fs.writeFileSync('/globbed/outside.txt', 'not in the context');

		const results = ctx.globSync('**/*.txt', { cwd: '/' });
		assert(results.includes('globbed/inside.txt'), 'should match files in the context root');
		assert(!results.includes('globbed/outside.txt'), 'should not match files outside the context root');
	});

	test('glob should keep the context', async () => {
		const results = await Array.fromAsync(ctx.promises.glob('**/*.txt', { cwd: '/' }));

		assert(results.includes('globbed/inside.txt'));
		assert(!results.includes('globbed/outside.txt'), 'should not match files outside the context root');
	});

	test('glob resolves a relative cwd against the context', () => {
		const { pwd } = context;
		context.pwd = '/';

		assert.deepEqual(ctx.globSync('*', { cwd: '/globbed' }), ['inside.txt']);
		assert.deepEqual(ctx.globSync('*', { cwd: 'globbed' }), ['inside.txt']);

		context.pwd = pwd;
	});

	test('glob defaults cwd to the working directory of the context', () => {
		const { pwd } = context;
		context.pwd = '/globbed';

		assert.deepEqual(ctx.globSync('*'), ['inside.txt']);

		context.pwd = pwd;
	});

	test('copyFileSync should keep the context #307', () => {
		ctx.writeFileSync('/source.txt', 'not in real root!');
		ctx.copyFileSync('/source.txt', '/copy.txt');

		assert.equal(ctx.readFileSync('/copy.txt', 'utf-8'), 'not in real root!');
		assert(fs.readdirSync('/ctx').includes('copy.txt'));
	});
});
