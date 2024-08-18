import { Stats } from '../../src/stats.js';
import { fs } from '../common.js';

describe('Stats', () => {
	const existing_file = 'x.txt';

	test('stat empty path', async () => {
		try {
			await fs.promises.stat('');
		} catch (err) {
			expect(err).toBeTruthy();
		}
	});

	test('stat directory', async () => {
		const stats = await fs.promises.stat('/');
		expect(stats).toBeInstanceOf(Stats);
	});

	test('lstat directory', async () => {
		const stats = await fs.promises.lstat('/');
		expect(stats).toBeInstanceOf(Stats);
	});

	test('FileHandle.stat', async () => {
		const handle = await fs.promises.open(existing_file, 'r');
		const stats = await handle.stat();
		expect(stats).toBeInstanceOf(Stats);
		await handle.close();
	});

	test('fstatSync file', () => {
		const fd = fs.openSync(existing_file, 'r');
		const stats = fs.fstatSync(fd);
		expect(stats).toBeInstanceOf(Stats);
		fs.close(fd);
	});

	test('stat file', async () => {
		const stats = await fs.promises.stat(existing_file);
		expect(stats.isDirectory()).toBe(false);
		expect(stats.isFile()).toBe(true);
		expect(stats.isSocket()).toBe(false);
		expect(stats.isBlockDevice()).toBe(false);
		expect(stats.isCharacterDevice()).toBe(false);
		expect(stats.isFIFO()).toBe(false);
		expect(stats.isSymbolicLink()).toBe(false);
		expect(stats).toBeInstanceOf(Stats);
	});
});
