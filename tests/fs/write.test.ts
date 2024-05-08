import { fs } from '../common';

describe('write', () => {
	test('write file with specified content', async () => {
		const fn = 'write.txt';
		const expected = 'ümlaut.';

		const handle = await fs.promises.open(fn, 'w', 0o644);
		await handle.write('', 0, 'utf8');
		const { bytesWritten } = await handle.write(expected, 0, 'utf8');
		expect(bytesWritten).toBe(Buffer.from(expected).length);
		await handle.close();

		const data = await fs.promises.readFile(fn, 'utf8');
		expect(data).toBe(expected);

		await fs.promises.unlink(fn);
	});

	test('write a buffer to a file', async () => {
		const filename = 'write.txt';
		const expected = Buffer.from('hello');

		const handle = await fs.promises.open(filename, 'w', 0o644);

		const written = await handle.write(expected, 0, expected.length, null);

		expect(expected.length).toBe(written.bytesWritten);

		await handle.close();

		expect(await fs.promises.readFile(filename)).toEqual(expected);

		await fs.promises.unlink(filename);
	});
});

describe('writeSync', () => {
	test('write file with specified content', async () => {
		const fn = 'write.txt';
		const fd = fs.openSync(fn, 'w');

		let written = fs.writeSync(fd, '');
		expect(written).toBe(0);

		fs.writeSync(fd, 'foo');

		const data = Buffer.from('bár');
		written = fs.writeSync(fd, data, 0, data.length);
		expect(written).toBe(4);

		fs.closeSync(fd);

		expect(fs.readFileSync(fn, 'utf8')).toBe('foobár');
	});
});
