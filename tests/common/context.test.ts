import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { canary } from 'utilium';
import { context } from '../../dist/context.js';
import * as fs from '../../dist/vfs/index.js';
import { configure, InMemory } from '../../dist/index.js';

fs.mkdirSync('/ctx');
const childContext = context.createChildContext({ root: '/ctx' });

suite('Context', () => {
	test('create a file', () => {
		childContext.fs.writeFileSync('/example.txt', 'not in real root!');
		assert.deepEqual(fs.readdirSync('/'), ['ctx']);
		assert(fs.readdirSync('/ctx').includes('example.txt'));
	});

	test('linking', async () => {
		await childContext.fs.promises.symlink('/example.txt', '/link');
		assert.equal(await childContext.fs.promises.readlink('link', 'utf8'), '/example.txt');
		assert.equal(await fs.promises.readlink('/ctx/link'), '/example.txt');
		assert.deepEqual(await childContext.fs.promises.readFile('/link', 'utf-8'), await fs.promises.readFile('/ctx/example.txt', 'utf-8'));

		// The symlink should only work inside the chroot /ctx
		assert.throws(() => fs.readFileSync('/ctx/link'));
	});

	test('path resolution', async () => {
		// Correct/normal
		assert.equal(childContext.fs.realpathSync('/'), '/');
		assert.equal(childContext.fs.realpathSync('example.txt'), '/example.txt');
		assert.equal(childContext.fs.realpathSync('../link'), '/example.txt');
		assert.equal(await childContext.fs.promises.realpath('/../link'), '/example.txt');

		assert.equal(fs.realpathSync('/ctx/link'), '/example.txt');
	});

	test('break-out fails', () => {
		assert.notDeepEqual(childContext.fs.readdirSync('/../../../'), ['ctx']);
	});

	test('watch should consider context', async () => {
		let lastFile: string | null = null,
			events = 0;
		const watcher = childContext.fs.promises.watch('/', { recursive: true });

		const silence = canary();
		const promise = (async () => {
			for await (const event of watcher) {
				lastFile = event.filename;
				if (++events == 2) return;
			}
		})();
		silence();
		await childContext.fs.promises.writeFile('/xpto.txt', 'in real root');
		assert.equal(lastFile, 'xpto.txt');
		await childContext.fs.promises.unlink('/xpto.txt');
		assert.equal(lastFile, 'xpto.txt');
		await watcher.return!();
		await promise;
	});

	test('Path resolution of / with context root and mount point being the same', async () => {
		// @zenfs/core#226
		await configure({
			mounts: { '/bananas': InMemory },
		});

		const bananas = context.createChildContext({ root: '/bananas' });

		fs.writeFileSync('/bananas/yellow', 'true');

		assert.deepEqual(bananas.fs.readdirSync('/'), ['yellow']);
	});

	test('Two isolated file trees writing to same file path', async () => {
		var { fs: fs1 } = context.createChildContext({ root: '/', mounts: new Map([['/', InMemory.create({ label: 'root' })]]) });
		var { fs: fs2 } = context.createChildContext({ root: '/', mounts: new Map([['/', InMemory.create({ label: 'root' })]]) });

		fs1.writeFileSync('/example.txt', 'fs1');
		fs2.writeFileSync('/example.txt', 'fs2');
		assert.equal(fs1.readFileSync('/example.txt', 'utf8'), 'fs1');
		assert.throws(() => fs.readFileSync('/example.txt', 'utf8'));
	});
});
