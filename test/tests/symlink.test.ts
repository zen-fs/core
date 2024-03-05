import { backends, fs, fixturesDir } from '../common';
import * as path from 'path';

describe.each(backends)('%s Link and Symlink Test', (name, options) => {
	it('should create and read symbolic link', async () => {
		const linkData = path.join(fixturesDir, '/cycles/root.js');
		const linkPath = 'symlink1.js';

		// Delete previously created link
		try {
			await fs.promises.unlink(linkPath);
		} catch (e) {}

		await fs.promises.symlink(linkData, linkPath);
		console.log('symlink done');

		const destination = await fs.promises.readlink(linkPath);
		expect(destination).toBe(linkData);
	});

	it('should create and read hard link', async () => {
		const srcPath = path.join(fixturesDir, 'cycles', 'root.js');
		const dstPath = 'link1.js';

		// Delete previously created link
		try {
			await fs.promises.unlink(dstPath);
		} catch (e) {}

		await fs.promises.link(srcPath, dstPath);
		console.log('hard link done');

		const srcContent = await fs.promises.readFile(srcPath, 'utf8');
		const dstContent = await fs.promises.readFile(dstPath, 'utf8');
		expect(srcContent).toBe(dstContent);
	});
});

describe.each(backends)('%s Symbolic Link Test', (name, options) => {
	// test creating and reading symbolic link
	const linkData = path.join(fixturesDir, 'cycles/');
	const linkPath = 'cycles_link';

	beforeAll(async () => {
		// Delete previously created link
		await fs.promises.unlink(linkPath);

		console.log('linkData: ' + linkData);
		console.log('linkPath: ' + linkPath);

		await fs.promises.symlink(linkData, linkPath, 'junction');
		return;
	});

	it('should lstat symbolic link', async () => {
		if (fs.getMount('/').metadata.readonly) {
			return;
		}

		const stats = await fs.promises.lstat(linkPath);
		expect(stats.isSymbolicLink()).toBe(true);
	});

	it('should readlink symbolic link', async () => {
		if (fs.getMount('/').metadata.readonly) {
			return;
		}
		const destination = await fs.promises.readlink(linkPath);
		expect(destination).toBe(linkData);
	});

	it('should unlink symbolic link', async () => {
		if (fs.getMount('/').metadata.readonly) {
			return;
		}
		await fs.promises.unlink(linkPath);
		expect(await fs.promises.exists(linkPath)).toBe(false);
		expect(await fs.promises.exists(linkData)).toBe(true);
	});
});
