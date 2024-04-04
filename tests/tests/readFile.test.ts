import { fs } from '../common';
import * as path from 'path';

describe('File Reading', () => {
	it('Cannot read a file with an invalid encoding (synchronous)', async () => {
		let wasThrown = false;

		try {
			fs.readFileSync('a.js', <BufferEncoding>'wrongencoding');
		} catch (e) {
			wasThrown = true;
		}
		expect(wasThrown).toBeTruthy();
	});

	it('Reading past the end of a file should not be an error', async () => {
		const fd = await fs.promises.open('a.js', 'r');
		const buffData = Buffer.alloc(10);
		const { bytesRead } = await fs.promises.read(fd, buffData, 0, 10, 10000);
		expect(bytesRead).toBe(0);
	});
});

describe('Read and Unlink File Test', () => {
	const dirName = 'test-readfile-unlink';
	const fileName = path.resolve(dirName, 'test.bin');

	const buf = Buffer.alloc(512);
	buf.fill(42);

	beforeAll(async () => {
		await fs.promises.mkdir(dirName);
		await fs.promises.writeFile(fileName, buf);
	});

	it('should read file and verify its content', async () => {
		const data: Uint8Array = await fs.promises.readFile(fileName);
		expect(data.length).toBe(buf.length);
		expect(data[0]).toBe(42);
	});

	it('should unlink file and remove directory', async () => {
		await fs.promises.unlink(fileName);
		await fs.promises.rmdir(dirName);
	});
});

describe('Read File Test', () => {
	const fn = 'empty.txt';

	it('should read file asynchronously', async () => {
		const data: Uint8Array = await fs.promises.readFile(fn);
		expect(data).toBeDefined();
	});

	it('should read file with utf-8 encoding asynchronously', async () => {
		const data: string = await fs.promises.readFile(fn, 'utf8');
		expect(data).toBe('');
	});

	it('should read file synchronously', async () => {
		const data: Uint8Array = fs.readFileSync(fn);
		expect(data).toBeDefined();
	});

	it('should read file with utf-8 encoding synchronously', async () => {
		const data: string = fs.readFileSync(fn, 'utf8');
		expect(data).toBe('');
	});
});
