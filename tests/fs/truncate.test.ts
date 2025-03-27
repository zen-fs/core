import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const path: string = 'truncate-file.txt',
	size = 1024 * 16,
	data = new Uint8Array(size).fill('x'.charCodeAt(0));

suite('Truncating', () => {
	test('Sync path functions', () => {
		fs.writeFileSync(path, data);
		assert.equal(fs.statSync(path).size, size);

		fs.truncateSync(path, 1024);
		assert.equal(fs.statSync(path).size, 1024);

		fs.truncateSync(path);
		assert.equal(fs.statSync(path).size, 0);

		fs.writeFileSync(path, data);
		assert.equal(fs.statSync(path).size, size);
	});

	test('FD functions', () => {
		const fd = fs.openSync(path, 'r+');

		fs.ftruncateSync(fd, 1024);
		assert.equal(fs.fstatSync(fd).size, 1024);

		fs.ftruncateSync(fd);
		assert.equal(fs.fstatSync(fd).size, 0);

		fs.closeSync(fd);
	});

	const statSize = async (path: string) => (await fs.promises.stat(path)).size;

	test('Async path functions', async () => {
		await fs.promises.writeFile(path, data);

		assert.equal(await statSize(path), 1024 * 16);

		await fs.promises.truncate(path, 1024);
		assert.equal(await statSize(path), 1024);

		await fs.promises.truncate(path);
		assert.equal(await statSize(path), 0);

		await fs.promises.writeFile(path, data);
		assert.equal(await statSize(path), size);
	});

	test('FileHandle', async () => {
		const handle = await fs.promises.open(path, 'w');

		await handle.truncate(1024);
		await handle.sync();
		assert.equal(await statSize(path), 1024);

		await handle.truncate();
		await handle.sync();
		assert.equal(await statSize(path), 0);

		await handle.close();
	});
});
