import { fs } from '../common.js';

describe('Reading', () => {
	test('Cannot read a file with an invalid encoding', async () => {
		let wasThrown = false;

		try {
			fs.readFileSync('a.js', 'wrongencoding' as BufferEncoding);
		} catch (e) {
			wasThrown = true;
		}
		expect(wasThrown).toBeTruthy();
	});

	test('Reading past the end of a file should not be an error', async () => {
		const handle = await fs.promises.open('a.js', 'r');
		const { bytesRead } = await handle.read(new Uint8Array(10), 0, 10, 10000);
		expect(bytesRead).toBe(0);
	});
});

describe('Read and Unlink', () => {
	const dir = 'test-readfile-unlink';
	const file = 'test-readfile-unlink/test.bin';
	const data = new Uint8Array(512).fill(42);

	test('create directory and write file', async () => {
		await fs.promises.mkdir(dir);
		await fs.promises.writeFile(file, data);
	});

	test('read file and verify its content', async () => {
		const data: Uint8Array = await fs.promises.readFile(file);
		expect(data.length).toBe(data.length);
		expect(data[0]).toBe(42);
	});

	test('unlink file and remove directory', async () => {
		await fs.promises.unlink(file);
		await fs.promises.rmdir(dir);
	});
});

describe('Read File Test', () => {
	const fn = 'empty.txt';

	test('read file asynchronously', async () => {
		const data: Uint8Array = await fs.promises.readFile(fn);
		expect(data).toBeDefined();
	});

	test('read file with utf-8 encoding asynchronously', async () => {
		const data: string = await fs.promises.readFile(fn, 'utf8');
		expect(data).toBe('');
	});

	test('read file synchronously', async () => {
		const data: Uint8Array = fs.readFileSync(fn);
		expect(data).toBeDefined();
	});

	test('read file with utf-8 encoding synchronously', async () => {
		const data: string = fs.readFileSync(fn, 'utf8');
		expect(data).toBe('');
	});
});

describe('fs file reading', () => {
	test('read file synchronously and verify the content', async () => {
		const content = fs.readFileSync('elipses.txt', 'utf8');

		for (let i = 0; i < content.length; i++) {
			expect(content[i]).toBe('\u2026');
		}

		expect(content.length).toBe(10000);
	});
});
