import assert from 'node:assert';
import { suite, test } from 'node:test';
import { join } from '../../src/emulation/path.ts';
import { fs } from '../common.ts';

suite('Links', () => {
	const target = '/a1.js',
		symlink = 'symlink1.js',
		hardlink = 'link1.ts';

	test('symlink', async () => {
		await fs.promises.symlink(target, symlink);
	});

	test('lstat', async () => {
		const stats = await fs.promises.lstat(symlink);
		assert(stats.isSymbolicLink());
	});

	test('readlink', async () => {
		const destination = await fs.promises.readlink(symlink);
		assert(destination === target);
	});

	test('unlink', async () => {
		await fs.promises.unlink(symlink);
		assert(!(await fs.promises.exists(symlink)));
		assert(await fs.promises.exists(target));
	});

	test('link', async () => {
		await fs.promises.link(target, hardlink);
		const targetContent = await fs.promises.readFile(target, 'utf8');
		const linkContent = await fs.promises.readFile(hardlink, 'utf8');
		assert(targetContent === linkContent);
	});

	test('file inside symlinked directory', async () => {
		await fs.promises.symlink('.', 'link');
		const targetContent = await fs.promises.readFile(target, 'utf8');
		const link = join('link', target);
		assert((await fs.promises.realpath(link)) === target);
		const linkContent = await fs.promises.readFile(link, 'utf8');
		assert(targetContent === linkContent);
	});
});
