// SPDX-License-Identifier: LGPL-3.0-or-later
import { bindContext, fs as rootFS } from '@zenfs/core';
import { defaultContext } from '@zenfs/core/internal/contexts';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('umask', () => {
	const modeOf = async (path: string) => (await rootFS.promises.stat(path)).mode & 0o7777;

	test('the default context masks nothing', () => {
		assert.equal(defaultContext.umask, 0);
		assert.equal(bindContext({}).umask, 0);
	});

	test('a file created through a context loses the bits its umask clears', async () => {
		const ctx = bindContext({ umask: 0o022 });
		ctx.fs.writeFileSync('/umask-sync-file', 'x', { mode: 0o666 });
		await ctx.fs.promises.writeFile('/umask-async-file', 'x', { mode: 0o666 });
		assert.equal(await modeOf('/umask-sync-file'), 0o644);
		assert.equal(await modeOf('/umask-async-file'), 0o644);

		const strict = bindContext({ umask: 0o077 });
		strict.fs.writeFileSync('/umask-private', 'x', { mode: 0o666 });
		assert.equal(await modeOf('/umask-private'), 0o600);
	});

	test('a directory is masked too, recursive creation included', async () => {
		const ctx = bindContext({ umask: 0o027 });
		ctx.fs.mkdirSync('/umask-dir-sync', { mode: 0o777 });
		await ctx.fs.promises.mkdir('/umask-dir-async', { mode: 0o777 });
		await ctx.fs.promises.mkdir('/umask-deep/a/b', { recursive: true });
		assert.equal(await modeOf('/umask-dir-sync'), 0o750);
		assert.equal(await modeOf('/umask-dir-async'), 0o750);
		assert.equal(await modeOf('/umask-deep/a'), 0o750);
		assert.equal(await modeOf('/umask-deep/a/b'), 0o750);
	});

	test('the default modes are masked: 0o644 files and 0o777 directories', async () => {
		const ctx = bindContext({ umask: 0o077 });
		ctx.fs.writeFileSync('/umask-default-file', 'x');
		ctx.fs.mkdirSync('/umask-default-dir');
		assert.equal(await modeOf('/umask-default-file'), 0o600);
		assert.equal(await modeOf('/umask-default-dir'), 0o700);
	});

	test('only the permission bits are masked, and chmod is not masked at all', async () => {
		const ctx = bindContext({ umask: 0o077 });
		ctx.fs.writeFileSync('/umask-chmod', 'x', { mode: 0o666 });
		ctx.fs.chmodSync('/umask-chmod', 0o4755);
		assert.equal(await modeOf('/umask-chmod'), 0o4755);
		ctx.fs.mkdirSync('/umask-sticky', { mode: 0o1777 });
		assert.equal(await modeOf('/umask-sticky'), 0o1700);
	});

	test('an existing file keeps its mode when it is opened for writing', async () => {
		await rootFS.promises.writeFile('/umask-existing', 'old', { mode: 0o666 });
		await rootFS.promises.chmod('/umask-existing', 0o666);
		bindContext({ umask: 0o077 }).fs.writeFileSync('/umask-existing', 'new');
		assert.equal(await modeOf('/umask-existing'), 0o666);
	});

	test('symbolic links are not masked', async () => {
		bindContext({ umask: 0o077 }).fs.symlinkSync('/umask-existing', '/umask-link');
		assert.equal((await rootFS.promises.lstat('/umask-link')).mode & 0o777, 0o777);
	});

	test('a child context starts with its parent\'s umask, and can set its own', () => {
		const parent = bindContext({ umask: 0o027 });
		const inherited = bindContext.call(parent, {});
		assert.equal(inherited.umask, 0o027);
		assert.equal(bindContext.call(parent, { umask: 0o002 }).umask, 0o002);

		// changing one afterwards does not reach the other, as with a forked process
		inherited.umask = 0o077;
		assert.equal(parent.umask, 0o027);
	});

	test('only the permission bits of a umask count', () => {
		assert.equal(bindContext({ umask: 0o7022 }).umask, 0o022);
	});
});
