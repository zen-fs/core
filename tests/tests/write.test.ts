import { fs } from '../common';

describe('write', () => {
	it('should write file with specified content asynchronously', async () => {
		const fn = 'write.txt';
		const fn2 = 'write2.txt';
		const expected = 'ümlaut.';

		const handle = await fs.promises.open(fn, 'w', 0o644);
		await fs.promises.write(handle, '', 0, 'utf8');
		const written = await fs.promises.write(handle, expected, 0, 'utf8');
		expect(written.bytesWritten).toBe(expected.length);
		await handle.close();

		const data = await fs.promises.readFile(fn, 'utf8');
		expect(data).toBe(expected);

		await fs.promises.unlink(fn);
		const fd2 = await fs.promises.open(fn2, 'w', 0o644);
		await fs.promises.write(fd2, '', 0, 'utf8');
		const written2 = await fs.promises.write(fd2, expected, 0, 'utf8');
		expect(written2.bytesWritten).toBe(Buffer.byteLength(expected));
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

		expect(expected.length).toBe(written.bytesWritten);

		await fd.close();

		const found = await fs.promises.readFile(filename, 'utf8');
		expect(expected.toString()).toBe(found);

		await fs.promises.unlink(filename);
	});
});

describe('writeSync', () => {
	it('should write file synchronously with specified content', async () => {
		const fn = 'write.txt';
		const foo = 'foo';
		const fd = fs.openSync(fn, 'w');

		let written = fs.writeSync(fd, '');
		expect(written).toBe(0);

		fs.writeSync(fd, foo);

		const bar = 'bár';
		written = fs.writeSync(fd, Buffer.from(bar), 0, Buffer.byteLength(bar));
		expect(written).toBeGreaterThan(3);

		fs.closeSync(fd);

		expect(fs.readFileSync(fn).toString()).toBe('foobár');
	});
});
