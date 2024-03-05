import { fs } from '../common';

describe('fs.write', () => {
	it('should write file with specified content asynchronously', async () => {
		const fn = 'write.txt';
		const fn2 = 'write2.txt';
		const expected = 'ümlaut.';

		const fd = await fs.promises.open(fn, 'w', 0o644);
		await fs.promises.write(fd, '', 0, 'utf8');
		const written = await fs.promises.write(fd, expected, 0, 'utf8');
		expect(written).toBe(Buffer.byteLength(expected));
		await fd.close();

		const data = await fs.promises.readFile(fn, 'utf8');
		expect(data).toBe(expected);

		await fs.promises.unlink(fn);
		const fd2 = await fs.promises.open(fn2, 'w', 0o644);
		await fs.promises.write(fd2, '', 0, 'utf8');
		const written2 = await fs.promises.write(fd2, expected, 0, 'utf8');
		expect(written2).toBe(Buffer.byteLength(expected));
		await fd2.close();

		const data2 = await fs.promises.readFile(fn2, 'utf8');
		expect(data2).toBe(expected);

		await fs.promises.unlink(fn2);
	});

	it('should write a buffer to a file asynchronously', async () => {
		const filename = 'write.txt';
		const expected = Buffer.from('hello');

		const fd = await fs.promises.open(filename, 'w', 0o644);

		const written = await fs.promises.write(fd, expected, 0, expected.length, null);

		expect(expected.length).toBe(written);

		await fd.close();

		const found = await fs.promises.readFile(filename, 'utf8');
		expect(expected.toString()).toBe(found);

		await fs.promises.unlink(filename);
	});
});
