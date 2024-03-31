import { fs } from '../common';

describe('Link and Symlink Test', () => {
	const target = 'a1.js',
		symlink = 'symlink1.js',
		hardlink = 'link1.js';

	test('symlink', async () => {
		await fs.promises.symlink(target, symlink);
	});

	test('lstat', async () => {
		const stats = await fs.promises.lstat(symlink);
		expect(stats.isSymbolicLink()).toBe(true);
	});

	test('readlink', async () => {
		const destination = await fs.promises.readlink(symlink);
		expect(destination).toBe(target);
	});

	test('unlink', async () => {
		await fs.promises.unlink(symlink);
		expect(await fs.promises.exists(symlink)).toBe(false);
		expect(await fs.promises.exists(target)).toBe(true);
	});

	test('link', async () => {
		await fs.promises.link(target, hardlink);
		const targetContent = await fs.promises.readFile(target, 'utf8');
		const linkContent = await fs.promises.readFile(hardlink, 'utf8');
		expect(targetContent).toBe(linkContent);
	});
});
