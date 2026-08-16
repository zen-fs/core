// SPDX-License-Identifier: LGPL-3.0-or-later
import { sync } from '@zenfs/core';
import { Buffer } from 'buffer';
import assert from 'node:assert/strict';
import type { OpenMode, PathLike } from 'node:fs';
import { suite, test } from 'node:test';
import { promisify } from 'node:util';
import { config, fs } from '../common.ts';

const filepath = 'x.txt';
const expected = 'xyz\n';
const ellipses = '…'.repeat(10_000);

suite('read', () => {
	test('read file asynchronously', config('async'), async () => {
		await using handle = await fs.promises.open(filepath, 'r');
		const { bytesRead, buffer } = await handle.read(Buffer.alloc(expected.length), 0, expected.length, 0);
		assert.equal(bytesRead, expected.length);
		assert.equal(buffer.toString(), expected);
	});

	test('read file synchronously', config('sync'), () => {
		const fd = fs.openSync(filepath, 'r');
		const buffer = Buffer.alloc(expected.length);
		const bytesRead = fs.readSync(fd, buffer, 0, expected.length, 0);

		assert.equal(bytesRead, expected.length);
		assert.equal(buffer.toString(), expected);
	});

	test('Read a file and check its binary bytes asynchronously', config('async'), async () => {
		const buff = await fs.promises.readFile('elipses.txt');
		assert.equal(buff.length, 30_000);
		assert.equal(buff.toString(), ellipses);
		assert.equal((buff[1] << 8) | buff[0], 32994);
	});

	test('Read a file and check its binary bytes synchronously', config('sync'), () => {
		const buff = fs.readFileSync('elipses.txt');
		assert.equal(buff.length, 30_000);
		assert.equal(buff.toString(), ellipses);
		assert.equal((buff[1] << 8) | buff[0], 32994);
	});

	const bufferAsync = Buffer.alloc(expected.length);
	const bufferSync = Buffer.alloc(expected.length);

	test('read file from handle asynchronously', config('async'), async () => {
		await using handle = await fs.promises.open(filepath, 'r');
		const { bytesRead } = await handle.read(bufferAsync, 0, expected.length, 0);

		assert.equal(bytesRead, expected.length);
		assert.equal(bufferAsync.toString(), expected);
	});

	test('read file from handle synchronously', config('sync'), () => {
		const fd = fs.openSync(filepath, 'r');
		const bytesRead = fs.readSync(fd, bufferSync, 0, expected.length, 0);

		assert.equal(bufferSync.toString(), expected);
		assert.equal(bytesRead, expected.length);
	});

	test('read file synchronously to non-zero offset', config('sync'), () => {
		const fd = fs.openSync(filepath, 'r');
		const buffer = Buffer.alloc(expected.length + 10);
		const bytesRead = fs.readSync(fd, buffer, 10, expected.length, 0);

		assert.equal(buffer.subarray(10, buffer.length).toString(), expected);
		assert.equal(bytesRead, expected.length);
	});

	test('read using callback API #239', config('sync', 'write'), async () => {
		const path = '/text.txt';

		fs.writeFileSync(path, 'hello world');
		await sync();

		const fd: number = (await promisify<PathLike, OpenMode, number | string>(fs.open)(path, 0, 0)) as any;

		const read = promisify(fs.read);

		const buf = Buffer.alloc(1024);
		const n0 = await read(fd, buf, 0, 1024, undefined);
		assert.equal(n0, 11);
		assert.equal(buf.subarray(0, n0).toString('utf8'), 'hello world');

		const n1 = await read(fd, buf, 0, 1024, undefined);
		assert.equal(n1, 0);
		assert.equal(buf.subarray(0, n1).toString('utf8'), '');

		await promisify(fs.close)(fd);
	});
});
