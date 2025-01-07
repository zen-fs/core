import { suite, test } from 'node:test';
import assert from 'node:assert';
import { bindContext } from '../../dist/context.js';
import * as fs from '../../dist/vfs/index.js';

fs.mkdirSync('/ctx');
const { fs: ctx } = bindContext('/ctx');

suite('Context', () => {
	test('create a file', () => {
		ctx.writeFileSync('/example.txt', 'not in real root!');
		assert.deepEqual(fs.readdirSync('/'), ['ctx']);
		assert(fs.readdirSync('/ctx').includes('example.txt'));
	});

	test('linking', async () => {
		await ctx.promises.symlink('/example.txt', '/link');
		assert.strictEqual(await ctx.promises.readlink('link', 'utf8'), '/example.txt');
		assert.strictEqual(await fs.promises.readlink('/ctx/link'), '/example.txt');
		assert.deepEqual(await ctx.promises.readFile('/link', 'utf-8'), await fs.promises.readFile('/ctx/example.txt', 'utf-8'));

		// The symlink should only work inside the chroot /ctx
		assert.throws(() => fs.readFileSync('/ctx/link'));
	});

	test('path resolution', async () => {
		// Correct/normal
		assert.strictEqual(ctx.realpathSync('/'), '/');
		assert.strictEqual(ctx.realpathSync('example.txt'), '/example.txt');
		assert.strictEqual(ctx.realpathSync('../link'), '/example.txt');
		assert.strictEqual(await ctx.promises.realpath('/../link'), '/example.txt');

		assert.strictEqual(fs.realpathSync('/ctx/link'), '/example.txt');
	});

	test('break-out fails', () => {
		assert.notDeepEqual(ctx.readdirSync('/../../../'), ['ctx']);
	});

	test('watch should consider context', async () => {
		let lastFile: string,
			events = 0;
		const watcher = ctx.promises.watch('/', { recursive: true });

		(async () => {
			for await (const event of watcher) {
				lastFile = event.filename!;
				if (++events == 2) return;
			}
		})();
		await ctx.promises.writeFile('/xpto.txt', 'in real root');
		assert.strictEqual(lastFile!, 'xpto.txt');
		await ctx.promises.unlink('/xpto.txt');
		assert.strictEqual(lastFile, 'xpto.txt');
	});
});
