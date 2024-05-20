import { wait } from 'utilium';
import { _toUnixTimestamp } from '../../src/utils.js';
import { fs } from '../common.js';

describe('times', () => {
	const path = 'x.txt';

	function expect_ok(resource: string | number, atime: Date | number, mtime: Date | number) {
		const stats = typeof resource == 'string' ? fs.statSync(resource) : fs.fstatSync(resource);
		// check up to single-second precision since sub-second precision is OS and fs dependent
		expect(_toUnixTimestamp(atime)).toEqual(_toUnixTimestamp(stats.atime));
		expect(_toUnixTimestamp(mtime)).toEqual(_toUnixTimestamp(stats.mtime));
	}

	async function runTest(atime: Date | number, mtime: Date | number): Promise<void> {
		await fs.promises.utimes(path, atime, mtime);
		expect_ok(path, atime, mtime);

		try {
			await fs.promises.utimes('foobarbaz', atime, mtime);
		} catch (error) {
			expect(error.code).toEqual('ENOENT');
		}

		// don't close this fd
		const handle = await fs.promises.open(path, 'r');

		await handle.utimes(atime, mtime);
		expect_ok(handle.fd, atime, mtime);

		fs.utimesSync(path, atime, mtime);
		expect_ok(path, atime, mtime);

		// some systems don't have futimes
		// if there's an error, it be ENOSYS
		try {
			fs.futimesSync(handle.fd, atime, mtime);
			expect_ok(handle.fd, atime, mtime);
		} catch (err) {
			expect(err.code).toEqual('ENOSYS');
		}

		try {
			fs.utimesSync('foobarbaz', atime, mtime);
		} catch (err) {
			expect(err.code).toEqual('ENOENT');
		}

		try {
			fs.futimesSync(-1, atime, mtime);
		} catch (err) {
			expect(err.code).toEqual('EBADF');
		}
	}

	test('utimes works', async () => {
		await runTest(new Date('1982/09/10 13:37:00'), new Date('1982/09/10 13:37:00'));
		await runTest(new Date(), new Date());
		await runTest(123456.789, 123456.789);
		const stats = fs.statSync(path);
		await runTest(stats.atime, stats.mtime);
	});

	test('read changes atime', async () => {
		const before = fs.statSync(path).atimeMs;
		fs.readFileSync(path);
		await wait(100);
		const after = fs.statSync(path).atimeMs;
		expect(before).toBeLessThan(after);
	});

	test('write changes mtime', async () => {
		const before = fs.statSync(path).mtimeMs;
		fs.writeFileSync(path, 'cool');
		await wait(100);
		const after = fs.statSync(path).mtimeMs;
		expect(before).toBeLessThan(after);
	});
});
