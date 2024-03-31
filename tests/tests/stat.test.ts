import { fs } from '../common';

describe('File Stat Test', () => {
	const existing_file = 'x.txt';

	it('should handle empty file path', async () => {
		try {
			await fs.promises.stat('');
		} catch (err) {
			expect(err).toBeTruthy();
		}
	});

	it('should stat existing directory', async () => {
		const stats = await fs.promises.stat('/');
		expect(stats.mtime).toBeInstanceOf(Date);
	});

	it('should lstat existing directory', async () => {
		const stats = await fs.promises.lstat('/');
		expect(stats.mtime).toBeInstanceOf(Date);
	});

	it('should fstat existing file', async () => {
		const fd = await fs.promises.open(existing_file, 'r');
		expect(fd).toBeTruthy();

		const stats = await fd.stat();
		expect(stats.mtime).toBeInstanceOf(Date);
		await fd.close();
	});

	it('should fstatSync existing file', async () => {
		const fd = fs.openSync(existing_file, 'r');
		const stats = fs.fstatSync(fd);
		expect(stats.mtime).toBeInstanceOf(Date);
		fs.close(fd);
	});

	it('should stat existing file', async () => {
		const s = await fs.promises.stat(existing_file);
		expect(s.isDirectory()).toBe(false);
		expect(s.isFile()).toBe(true);
		expect(s.isSocket()).toBe(false);
		//expect(s.isBlockDevice()).toBe(false);
		expect(s.isCharacterDevice()).toBe(false);
		expect(s.isFIFO()).toBe(false);
		expect(s.isSymbolicLink()).toBe(false);
		expect(s.mtime).toBeInstanceOf(Date);
	});
});
