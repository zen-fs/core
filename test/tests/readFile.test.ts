import { backends, fs, configure, fixturesDir } from '../common';
import * as path from 'path';

describe.each(backends)('%s File Reading', (name, options) => {
	const configured = configure(options);
	it('Cannot read a file with an invalid encoding (synchronous)', async () => {
		await configured;

		let wasThrown = false;
		if (!fs.getMount('/').metadata.synchronous) {
			return;
		}

		try {
			fs.readFileSync(path.join(fixturesDir, 'a.js'), 'wrongencoding');
		} catch (e) {
			wasThrown = true;
		}
		expect(wasThrown).toBeTruthy();
	});

	it('Reading past the end of a file should not be an error', async () => {
		await configured;
		const fd = await fs.promises.open(path.join(fixturesDir, 'a.js'), 'r');
		const buffData = Buffer.alloc(10);
		const bytesRead = await fs.promises.read(fd, buffData, 0, 10, 10000);
		expect(bytesRead).toBe(0);
	});
});

describe.each(backends)('%s Read and Unlink File Test', (name, options) => {
	const configured = configure(options);
	const dirName = path.resolve(fixturesDir, 'test-readfile-unlink');
	const fileName = path.resolve(dirName, 'test.bin');

	const buf = Buffer.alloc(512);
	buf.fill(42);

	beforeAll(async () => {
		await configured;
		await fs.promises.mkdir(dirName);
		await fs.promises.writeFile(fileName, buf);
	});

	it('should read file and verify its content', async () => {
		await configured;
		if (fs.getMount('/').metadata.readonly) {
			return;
		}
		const data: Uint8Array = await fs.promises.readFile(fileName);
		expect(data.length).toBe(buf.length);
		expect(data[0]).toBe(42);
	});

	it('should unlink file and remove directory', async () => {
		await configured;
		if (fs.getMount('/').metadata.readonly) {
			return;
		}
		await fs.promises.unlink(fileName);
		await fs.promises.rmdir(dirName);
	});
});

describe.each(backends)('%s Read File Test', (name, options) => {
	const configured = configure(options);
	const fn = path.join(fixturesDir, 'empty.txt');

	it('should read file asynchronously', async () => {
		await configured;
		const data: Uint8Array = await fs.promises.readFile(fn);
		expect(data).toBeDefined();
	});

	it('should read file with utf-8 encoding asynchronously', async () => {
		await configured;
		const data: string = await fs.promises.readFile(fn, 'utf8');
		expect(data).toBe('');
	});

	if (fs.getMount('/').metadata.synchronous) {
		it('should read file synchronously', async () => {
			await configured;
			const data: Uint8Array = fs.readFileSync(fn);
			expect(data).toBeDefined();
		});

		it('should read file with utf-8 encoding synchronously', async () => {
			await configured;
			const data: string = fs.readFileSync(fn, 'utf8');
			expect(data).toBe('');
		});
	}
});
