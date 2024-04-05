import { encode } from '../../src/utils';
import { fs } from '../common';

describe('write', () => {
	test('write file with specified content', async () => {
		const fn = 'write.txt';
		const expected = 'ümlaut.';

		const handle = await fs.promises.open(fn, 'w', 0o644);
		await handle.write('', 0, 'utf8');
		const { bytesWritten } = await handle.write(expected, 0, 'utf8');
		expect(bytesWritten).toBe(encode(expected).length);
		await handle.close();

		const data = await fs.promises.readFile(fn, 'utf8');
		expect(data).toBe(expected);

		await fs.promises.unlink(fn);
	});

	test('write a buffer to a file', async () => {
		const filename = 'write.txt';
		const expected = encode('hello');

		const fd = await fs.promises.open(filename, 'w', 0o644);

		const written = await fs.promises.write(fd, expected, 0, expected.length, null);

		expect(expected.length).toBe(written.bytesWritten);

		await fd.close();

		expect(await fs.promises.readFile(filename)).toEqual(expected);

		await fs.promises.unlink(filename);
	});
});

describe('writeSync', () => {
	test('write file with specified content', async () => {
		const fn = 'write.txt';
		const foo = 'foo';
		const fd = fs.openSync(fn, 'w');

		let written = fs.writeSync(fd, '');
		expect(written).toBe(0);

		fs.writeSync(fd, foo);

		const data = encode('bár');
		written = fs.writeSync(fd, data, 0, data.length);
		expect(written).toBeGreaterThan(3);

		fs.closeSync(fd);

		expect(fs.readFileSync(fn, 'utf8')).toBe('foobár');
	});
});
