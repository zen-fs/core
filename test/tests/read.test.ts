import { fs } from '../common';

describe('read', () => {
	let filepath: string;
	let expected: string;

	beforeEach(() => {
		filepath = 'x.txt';
		expected = 'xyz\n';
	});

	it('should read file asynchronously', async () => {
		const fd = await fs.promises.open(filepath, 'r');
		const buffer = Buffer.alloc(expected.length);
		const bytesRead = await fs.promises.read(fd, buffer, 0, expected.length, 0);

		expect(buffer.toString()).toEqual(expected);
		expect(bytesRead).toEqual(expected.length);
	});

	it('should read file synchronously', async () => {
		const fd = fs.openSync(filepath, 'r');
		const buffer = Buffer.alloc(expected.length);
		const bytesRead = fs.readSync(fd, buffer, 0, expected.length, 0);

		expect(buffer.toString()).toEqual(expected);
		expect(bytesRead).toEqual(expected.length);
	});
});

describe('read binary', () => {
	it('Read a file and check its binary bytes (asynchronous)', async () => {
		const buff = await fs.promises.readFile('elipses.txt');
		expect((buff[1] << 8) | buff[0]).toBe(32994);
	});

	it('Read a file and check its binary bytes (synchronous)', () => {
		const buff = fs.readFileSync('elipses.txt');
		expect((buff[1] << 8) | buff[0]).toBe(32994);
	});
});

describe('read buffer', () => {
	const filepath = 'x.txt';
	const expected = 'xyz\n';
	const bufferAsync = Buffer.alloc(expected.length);
	const bufferSync = Buffer.alloc(expected.length);

	it('should read file asynchronously', async () => {
		const fd = await fs.promises.open(filepath, 'r');
		const bytesRead = await fs.promises.read(fd, bufferAsync, 0, expected.length, 0);

		expect(bytesRead).toBe(expected.length);
		expect(bufferAsync.toString()).toBe(expected);
	});

	it('should read file synchronously', async () => {
		const fd = fs.openSync(filepath, 'r');
		const bytesRead = fs.readSync(fd, bufferSync, 0, expected.length, 0);

		expect(bufferSync.toString()).toBe(expected);
		expect(bytesRead).toBe(expected.length);
	});
});
