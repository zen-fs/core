import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path/posix';
import { suite, test } from 'node:test';
import { fs } from '../common.js';
import { data as dataPath } from '../setup.js';

const fileName = 'write.txt';
const utf8example = readFileSync(join(dataPath, 'utf8.txt'), 'utf8');

suite('Writes', () => {
	test('Using FileHandle and UTF-8', async () => {
		const expected = 'ümlaut.';

		const handle = await fs.promises.open(fileName, 'w', 0o644);
		await handle.write('', 0, 'utf8');
		const { bytesWritten } = await handle.write(expected, 0, 'utf8');
		assert.equal(bytesWritten, Buffer.from(expected).length);
		await handle.close();

		const data = await fs.promises.readFile(fileName, 'utf8');
		assert.equal(data, expected);

		await fs.promises.unlink(fileName);
	});

	test('Using FileHandle with buffer', async () => {
		const expected = Buffer.from('hello');

		const handle = await fs.promises.open(fileName, 'w', 0o644);

		const written = await handle.write(expected, 0, expected.length, null);

		assert.equal(expected.length, written.bytesWritten);

		await handle.close();

		assert.deepEqual(await fs.promises.readFile(fileName), expected);

		await fs.promises.unlink(fileName);
	});

	test('Using sync path functions', () => {
		const fd = fs.openSync(fileName, 'w');

		let written = fs.writeSync(fd, '');
		assert.equal(written, 0);

		fs.writeSync(fd, 'foo');

		const data = Buffer.from('bár');
		written = fs.writeSync(fd, data, 0, data.length);
		assert.equal(written, 4);

		fs.closeSync(fd);

		assert.equal(fs.readFileSync(fileName, 'utf8'), 'foobár');
	});

	test('Using promises API', async () => {
		const filename = 'test.txt';
		await fs.promises.writeFile(filename, utf8example);
		const data = await fs.promises.readFile(filename);
		assert.equal(data.length, Buffer.from(utf8example).length);
		await fs.promises.unlink(filename);
	});

	test('Using promises API with buffer', async () => {
		const filename = 'test2.txt';
		const expected = Buffer.from(utf8example, 'utf8');

		await fs.promises.writeFile(filename, expected);
		const actual = await fs.promises.readFile(filename);
		assert.equal(actual.length, expected.length);

		await fs.promises.unlink(filename);
	});

	test('Promises API with base64 data', async () => {
		const data = readFileSync(join(dataPath, 'image.jpg'), 'base64');

		const buffer = Buffer.from(data, 'base64');
		const filePath = 'test.jpg';

		await fs.promises.writeFile(filePath, buffer);

		const read = await fs.promises.readFile(filePath, 'base64');
		assert.equal(read, data);
	});

	test('Using sync path functions with custom mode', () => {
		const file = 'testWriteFileSync.txt';
		const mode = 0o755;

		fs.writeFileSync(file, '123', { mode });

		const content = fs.readFileSync(file, 'utf8');
		assert.equal(content, '123');
		assert.equal(fs.statSync(file).mode & 0o777, mode);

		fs.unlinkSync(file);
	});

	test('Appending to a file synchronously with custom mode', () => {
		const file = 'testAppendFileSync.txt';
		const mode = 0o755;

		fs.appendFileSync(file, 'abc', { mode });

		const content = fs.readFileSync(file, { encoding: 'utf8' });
		assert.equal(content, 'abc');

		assert.equal(fs.statSync(file).mode & 0o777, mode);

		fs.unlinkSync(file);
	});
});
