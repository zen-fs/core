import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

suite('Reading', () => {
	test('Cannot read a file with an invalid encoding', () => {
		assert.throws(() => fs.readFileSync('a.js', 'wrong-encoding' as BufferEncoding));
	});

	test('Reading past the end of a file should not be an error', async () => {
		const handle = await fs.promises.open('a.js', 'r');
		const { bytesRead } = await handle.read(new Uint8Array(10), 0, 10, 10000);
		assert.equal(bytesRead, 0);
	});

	const dir = 'test-readfile-unlink';
	const file = 'test-readfile-unlink/test.bin';
	const data = new Uint8Array(512).fill(42);

	test('create directory and write file', async () => {
		await fs.promises.mkdir(dir);
		await fs.promises.writeFile(file, data);
	});

	test('read file and verify its content', async () => {
		const read: Uint8Array = await fs.promises.readFile(file);
		assert.equal(read.length, data.length);
		assert.equal(read[0], 42);
	});

	test('unlink file and remove directory', async () => {
		await fs.promises.unlink(file);
		await fs.promises.rmdir(dir);
	});

	const fileName = 'empty.txt';

	test('read file', async () => {
		assert.equal((await fs.promises.readFile(fileName)).toString(), '');
		assert.equal(fs.readFileSync(fileName).toString(), '');
	});

	test('read file with utf-8 encoding', async () => {
		assert.equal(await fs.promises.readFile(fileName, 'utf8'), '');
		assert.equal(fs.readFileSync(fileName, 'utf8'), '');
	});

	test('read file synchronously and verify the content', () => {
		const content = fs.readFileSync('elipses.txt', 'utf8');

		assert.equal(content.length, 10000);

		for (let i = 0; i < content.length; i++) {
			assert.equal(content[i], '…');
		}
	});
});
