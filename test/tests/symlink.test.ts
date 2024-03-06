import { fs } from '../common';

describe('Link and Symlink Test', () => {
	it('should create and read symbolic link', async () => {
		const target = 'a1.js',
			link = 'symlink1.js';

		await fs.promises.symlink(target, link);

		const destination = await fs.promises.realpath(await fs.promises.readlink(link));
		expect(destination).toBe(target);
	});

	it('should create and read hard link', async () => {
		const src = 'cycles/root.js',
			dst = 'link1.js';

		await fs.promises.link(src, dst);

		const srcContent = await fs.promises.readFile(src, 'utf8');
		const dstContent = await fs.promises.readFile(dst, 'utf8');
		expect(srcContent).toBe(dstContent);
	});

	// test creating and reading symbolic link
	const linkData = 'cycles/',
		linkPath = 'cycles_link';

	it('should lstat symbolic link', async () => {
		await fs.promises.symlink(linkData, linkPath, 'junction');
		const stats = await fs.promises.lstat(linkPath);
		expect(stats.isSymbolicLink()).toBe(true);
	});

	it('should readlink symbolic link', async () => {
		await fs.promises.unlink(linkPath);
		await fs.promises.symlink(linkData, linkPath, 'junction');
		const destination = await fs.promises.readlink(linkPath);
		expect(destination).toBe(linkData);
	});

	it('should unlink symbolic link', async () => {
		await fs.promises.unlink(linkPath);
		await fs.promises.symlink(linkData, linkPath, 'junction');
		expect(await fs.promises.exists(linkPath)).toBe(false);
		expect(await fs.promises.exists(linkData)).toBe(true);
	});
});
