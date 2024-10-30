import assert from 'node:assert';
import { suite, test } from 'node:test';
import { wait } from 'utilium';
import { ErrnoError } from '../../dist/error.js';
import { _toUnixTimestamp } from '../../dist/utils.js';
import { fs } from '../common.js';

suite('times', () => {
	const path = 'x.txt';

	function expect_assert(resource: string | number, atime: Date | number, mtime: Date | number) {
		const stats = typeof resource == 'string' ? fs.statSync(resource) : fs.fstatSync(resource);
		// check up to single-second precision since sub-second precision is OS and fs dependent
		assert(_toUnixTimestamp(atime) == _toUnixTimestamp(stats.atime));
		assert(_toUnixTimestamp(mtime) == _toUnixTimestamp(stats.mtime));
	}

	async function runTest(atime: Date | number, mtime: Date | number): Promise<void> {
		await fs.promises.utimes(path, atime, mtime);
		expect_assert(path, atime, mtime);

		await fs.promises.utimes('foobarbaz', atime, mtime).catch((error: ErrnoError) => {
			assert(error instanceof ErrnoError);
			assert(error.code === 'ENOENT');
		});

		// don't close this fd
		const handle = await fs.promises.open(path, 'r');

		await handle.utimes(atime, mtime);
		expect_assert(handle.fd, atime, mtime);

		fs.utimesSync(path, atime, mtime);
		expect_assert(path, atime, mtime);

		// some systems don't have futimes
		// if there's an error, it be ENOSYS
		try {
			fs.futimesSync(handle.fd, atime, mtime);
			expect_assert(handle.fd, atime, mtime);
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert(error.code === 'ENOSYS');
		}

		try {
			fs.utimesSync('foobarbaz', atime, mtime);
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert(error.code === 'ENOENT');
		}

		try {
			fs.futimesSync(-1, atime, mtime);
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert(error.code == 'EBADF');
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
		assert(before < after);
	});

	test('write changes mtime', async () => {
		const before = fs.statSync(path).mtimeMs;
		fs.writeFileSync(path, 'cool');
		await wait(100);
		const after = fs.statSync(path).mtimeMs;
		assert(before < after);
	});
});
