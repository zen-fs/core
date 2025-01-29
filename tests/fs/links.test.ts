import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { join } from '../../dist/vfs/path.js';
import { fs } from '../common.js';
import type { ErrnoError } from '../../dist/index.js';

suite('Links', () => {
	const target = '/a1.js',
		symlink = 'symlink1.js',
		hardlink = 'link1.js';

	test('symlink', async () => {
		await fs.promises.symlink(target, symlink);
	});

	test('lstat', async () => {
		const stats = await fs.promises.lstat(symlink);
		assert(stats.isSymbolicLink());
	});

	test('readlink', async () => {
		const destination = await fs.promises.readlink(symlink);
		assert.equal(destination, target);
	});

	test('read target contents', async () => {
		assert.equal(await fs.promises.readFile(target, 'utf-8'), await fs.promises.readFile(symlink, 'utf-8'));
	});

	test('unlink', async () => {
		await fs.promises.unlink(symlink);
		assert(!(await fs.promises.exists(symlink)));
		assert(await fs.promises.exists(target));
	});

	test('link', async t => {
		const _ = await fs.promises.link(target, hardlink).catch((e: ErrnoError) => {
			if (e.code == 'ENOSYS') return e;
			throw e;
		});
		if (_) {
			return t.skip('Backend does not support hard links');
		}
		const targetContent = await fs.promises.readFile(target, 'utf8');
		const linkContent = await fs.promises.readFile(hardlink, 'utf8');
		assert.equal(targetContent, linkContent);
	});

	test('file inside symlinked directory', async () => {
		await fs.promises.symlink('.', 'link');
		const targetContent = await fs.promises.readFile(target, 'utf8');
		const link = join('link', target);
		assert((await fs.promises.realpath(link)) === target);
		const linkContent = await fs.promises.readFile(link, 'utf8');
		assert.equal(targetContent, linkContent);
	});
});
