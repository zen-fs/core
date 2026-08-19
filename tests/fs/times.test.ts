// SPDX-License-Identifier: LGPL-3.0-or-later
import type { StatsLike } from '@zenfs/core';
import type { Exception } from 'kerium';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { wait } from 'utilium';
import { config, fs } from '../common.ts';

const path = 'x.txt';

/**
 * Gets unix timestamps from stats
 *
 * @internal
 */
export function unixTimestamps(stats: StatsLike<number>): Record<'atime' | 'mtime', number> {
	return {
		atime: Math.floor(stats.atimeMs),
		mtime: Math.floor(stats.mtimeMs),
	};
}

suite('Times', config('times'), () => {
	async function runTest(atime: Date | number, mtime: Date | number): Promise<void> {
		// Numbers are seconds since the epoch, while `Date`s and stats are in milliseconds
		const times = {
			atime: typeof atime == 'number' ? Math.floor(atime * 1000) : atime.getTime(),
			mtime: typeof mtime == 'number' ? Math.floor(mtime * 1000) : mtime.getTime(),
		};

		await fs.promises.utimes(path, atime, mtime);

		assert.deepEqual(unixTimestamps(await fs.promises.stat(path)), times);

		await fs.promises.utimes('foobarbaz', atime, mtime).catch((error: Exception) => {
			assert(Error.isError(error));
			assert.equal(error.code, 'ENOENT');
		});

		await using handle = await fs.promises.open(path, 'r');

		await handle.utimes(atime, mtime);
		assert.deepEqual(unixTimestamps(await handle.stat()), times);

		fs.utimesSync(path, atime, mtime);
		assert.deepEqual(unixTimestamps(fs.statSync(path)), times);

		try {
			fs.utimesSync('foobarbaz', atime, mtime);
		} catch (error: any) {
			assert.equal(error.code, 'ENOENT');
		}

		try {
			fs.futimesSync(-1, atime, mtime);
		} catch (error: any) {
			// A negative descriptor fails range validation before it is looked up
			assert.equal(error.code, 'ERR_OUT_OF_RANGE');
		}
	}

	test('utimes works', async () => {
		await test('new Date(...)', () => runTest(new Date('1982/09/10 13:37:00'), new Date('1982/09/10 13:37:00')));
		await test('new Date()', () => runTest(new Date(), new Date()));
		await test('number', () => runTest(123456.789, 123456.789));
		const stats = fs.statSync(path);
		await test('from stats', () => runTest(stats.atime, stats.mtime));
	});

	test('read changes atime', config('sync'), async () => {
		const before = fs.statSync(path).atimeMs;
		fs.readFileSync(path);
		await wait(25);
		const after = fs.statSync(path).atimeMs;
		assert(before < after);
	});

	test('write changes mtime', config('sync', 'write'), async () => {
		const before = fs.statSync(path).mtimeMs;
		fs.writeFileSync(path, 'cool');
		await wait(25);
		const after = fs.statSync(path).mtimeMs;
		assert(before < after);
	});
});
