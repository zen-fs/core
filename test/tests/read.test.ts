import { backends, fs, configure, fixturesDir } from '../common';
import * as path from 'path';

describe.each(backends)('%s read', (name, options) => {
	const configured = configure(options);
	let filepath: string;
	let expected: string;
	let rootFS: any;

	beforeEach(() => {
		filepath = path.join(fixturesDir, 'x.txt');
		expected = 'xyz\n';
		rootFS = fs.getMount('/');
	});

	it('should read file asynchronously', async () => {
		await configured;
		const fd = await fs.promises.open(filepath, 'r');
		const buffer = Buffer.alloc(expected.length);
		const bytesRead = await fs.promises.read(fd, buffer, 0, expected.length, 0);

		expect(buffer.toString()).toEqual(expected);
		expect(bytesRead).toEqual(expected.length);
	});

	if (fs.getMount('/').metadata.synchronous) {
		it('should read file synchronously', async () => {
			await configured;
			const fd = fs.openSync(filepath, 'r');
			const buffer = Buffer.alloc(expected.length);
			const bytesRead = await fs.promises.readSync(fd, buffer, 0, expected.length, 0);

			expect(buffer.toString()).toEqual(expected);
			expect(bytesRead).toEqual(expected.length);
		});
	}
});

describe.each(backends)('%s read binary', (name, options) => {
	const configured = configure(options);

	it('Read a file and check its binary bytes (asynchronous)', async () => {
		await configured;
		const buff = await fs.promises.readFile(path.join(fixturesDir, 'elipses.txt'));
		expect(buff.readUInt16LE(0)).toBe(32994);
	});

	it('Read a file and check its binary bytes (synchronous)', () => {
		if (fs.getMount('/').metadata.synchronous) {
			const buff = fs.readFileSync(path.join(fixturesDir, 'elipses.txt'));
			expect(buff.readUInt16LE(0)).toBe(32994);
		}
	});
});

describe.each(backends)('%s read buffer', (name, options) => {
	const configured = configure(options);
	const filepath = path.join(fixturesDir, 'x.txt');
	const expected = 'xyz\n';
	const bufferAsync = Buffer.alloc(expected.length);
	const bufferSync = Buffer.alloc(expected.length);

	it('should read file asynchronously', async () => {
		await configured;
		const fd = await fs.promises.open(filepath, 'r');
		const bytesRead = await fs.promises.read(fd, bufferAsync, 0, expected.length, 0);

		expect(bytesRead).toBe(expected.length);
		expect(bufferAsync.toString()).toBe(expected);
	});

	it('should read file synchronously', async () => {
		await configured;
		if (fs.getMount('/').metadata.synchronous) {
			const fd = fs.openSync(filepath, 'r');
			const bytesRead = fs.readSync(fd, bufferSync, 0, expected.length, 0);

			expect(bufferSync.toString()).toBe(expected);
			expect(bytesRead).toBe(expected.length);
		}
	});
});
