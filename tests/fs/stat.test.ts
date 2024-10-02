import assert from 'node:assert';
import { suite, test } from 'node:test';
import { Stats } from '../../src/stats.js';
import { fs } from '../common.js';

suite('Stats', () => {
	const existing_file = 'x.txt';

	test('stat empty path', () => {
		assert.rejects(fs.promises.stat(''));
	});

	test('stat directory', async () => {
		const stats = await fs.promises.stat('/');
		assert(stats instanceof Stats);
	});

	test('lstat directory', async () => {
		const stats = await fs.promises.lstat('/');
		assert(stats instanceof Stats);
	});

	test('FileHandle.stat', async () => {
		const handle = await fs.promises.open(existing_file, 'r');
		const stats = await handle.stat();
		assert(stats instanceof Stats);
		await handle.close();
	});

	test('fstatSync file', () => {
		const fd = fs.openSync(existing_file, 'r');
		const stats = fs.fstatSync(fd);
		assert(stats instanceof Stats);
		fs.close(fd);
	});

	test('stat file', async () => {
		const stats = await fs.promises.stat(existing_file);
		assert(!stats.isDirectory());
		assert(stats.isFile());
		assert(!stats.isSocket());
		assert(!stats.isBlockDevice());
		assert(!stats.isCharacterDevice());
		assert(!stats.isFIFO());
		assert(!stats.isSymbolicLink());
		assert(stats instanceof Stats);
	});
});
