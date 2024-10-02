import assert from 'node:assert';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

suite('write', () => {
	test('write file with specified content', async () => {
		const fn = 'write.txt';
		const expected = 'ümlaut.';

		const handle = await fs.promises.open(fn, 'w', 0o644);
		await handle.write('', 0, 'utf8');
		const { bytesWritten } = await handle.write(expected, 0, 'utf8');
		assert(bytesWritten === Buffer.from(expected).length);
		await handle.close();

		const data = await fs.promises.readFile(fn, 'utf8');
		assert(data === expected);

		await fs.promises.unlink(fn);
	});

	test('write a buffer to a file', async () => {
		const filename = 'write.txt';
		const expected = Buffer.from('hello');

		const handle = await fs.promises.open(filename, 'w', 0o644);

		const written = await handle.write(expected, 0, expected.length, null);

		assert(expected.length === written.bytesWritten);

		await handle.close();

		assert((await fs.promises.readFile(filename)).equals(expected));

		await fs.promises.unlink(filename);
	});
});

suite('writeSync', () => {
	test('write file with specified content', () => {
		const fn = 'write.txt';
		const fd = fs.openSync(fn, 'w');

		let written = fs.writeSync(fd, '');
		assert(written === 0);

		fs.writeSync(fd, 'foo');

		const data = Buffer.from('bár');
		written = fs.writeSync(fd, data, 0, data.length);
		assert(written === 4);

		fs.closeSync(fd);

		assert(fs.readFileSync(fn, 'utf8') === 'foobár');
	});
});
