import { fs } from '../common.js';

const filepath: string = 'x.txt';
const expected: string = 'xyz\n';

describe('read', () => {
	test('read file asynchronously', async () => {
		const handle = await fs.promises.open(filepath, 'r');
		const { bytesRead, buffer } = await handle.read(Buffer.alloc(expected.length), 0, expected.length, 0);

		expect(bytesRead).toEqual(expected.length);
		expect(buffer.toString()).toEqual(expected);
	});

	test('read file synchronously', () => {
		const fd = fs.openSync(filepath, 'r');
		const buffer = Buffer.alloc(expected.length);
		const bytesRead = fs.readSync(fd, buffer, 0, expected.length, 0);

		expect(bytesRead).toEqual(expected.length);
		expect(buffer.toString()).toEqual(expected);
	});
});

describe('read binary', () => {
	test('Read a file and check its binary bytes (asynchronous)', async () => {
		const buff = await fs.promises.readFile('elipses.txt');
		expect((buff[1] << 8) | buff[0]).toBe(32994);
	});

	test('Read a file and check its binary bytes (synchronous)', () => {
		const buff = fs.readFileSync('elipses.txt');
		expect((buff[1] << 8) | buff[0]).toBe(32994);
	});
});

describe('read buffer', () => {
	const bufferAsync = Buffer.alloc(expected.length);
	const bufferSync = Buffer.alloc(expected.length);

	test('read file asynchronously', async () => {
		const handle = await fs.promises.open(filepath, 'r');
		const { bytesRead } = await handle.read(bufferAsync, 0, expected.length, 0);

		expect(bytesRead).toBe(expected.length);
		expect(bufferAsync.toString()).toBe(expected);
	});

	test('read file synchronously', () => {
		const fd = fs.openSync(filepath, 'r');
		const bytesRead = fs.readSync(fd, bufferSync, 0, expected.length, 0);

		expect(bufferSync.toString()).toBe(expected);
		expect(bytesRead).toBe(expected.length);
	});

	test('read file synchronously to non-zero offset', () => {
		const fd = fs.openSync(filepath, 'r');
		const buffer = Buffer.alloc(expected.length + 10);
		const bytesRead = fs.readSync(fd, buffer, 10, expected.length, 0);

		expect(buffer.subarray(10, buffer.length).toString()).toBe(expected);
		expect(bytesRead).toBe(expected.length);
	});
});
