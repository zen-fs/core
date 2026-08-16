// SPDX-License-Identifier: LGPL-3.0-or-later
import { test, suite } from 'node:test';
import { config, fs } from '../common.ts';
import assert from 'node:assert/strict';
import { basename } from 'node:path/posix';

await fs.promises.mkdir('/tmp');

suite('Temporary Directories', config('tempdir'), () => {
	test('mkdtempSync', config('sync'), () => {
		const path = fs.mkdtempSync('/tmp/test-', { encoding: 'utf8' });

		assert.deepEqual(fs.readdirSync('/tmp'), [basename(path)]);

		fs.rmdirSync(path);
	});

	test('mkdtemp', config('async'), async () => {
		const path = await fs.promises.mkdtemp('/tmp/test-', { encoding: 'utf8' });

		assert.deepEqual(await fs.promises.readdir('/tmp'), [basename(path)]);

		await fs.promises.rmdir(path);
	});

	test('mkdtempDisposableSync', config('sync'), () => {
		using result = fs.mkdtempDisposableSync('/tmp/test-', { encoding: 'utf8' });

		assert.deepEqual(fs.readdirSync('/tmp'), [basename(result.path)]);

		fs.rmdirSync(result.path);
	});

	test('mkdtempDisposable', config('async'), async () => {
		await using result = await fs.promises.mkdtempDisposable('/tmp/test-', { encoding: 'utf8' });

		assert.deepEqual(await fs.promises.readdir('/tmp'), [basename(result.path)]);

		await fs.promises.rmdir(result.path);
	});

	/* A relative prefix is resolved against the working directory, rather than always being placed in `/tmp`.
	Note the returned path keeps the prefix it was given, so it is only compared by basename here. */

	test('mkdtempSync with a relative prefix', config('sync'), () => {
		const path = fs.mkdtempSync('tmp/relative-', { encoding: 'utf8' });

		assert(basename(path).startsWith('relative-'));
		assert(fs.statSync(path).isDirectory());
		assert(fs.readdirSync('/tmp').includes(basename(path)));

		fs.rmdirSync(path);
	});

	test('mkdtemp with a relative prefix', config('async'), async () => {
		const path = await fs.promises.mkdtemp('tmp/relative-', { encoding: 'utf8' });

		assert(basename(path).startsWith('relative-'));
		assert((await fs.promises.stat(path)).isDirectory());
		assert((await fs.promises.readdir('/tmp')).includes(basename(path)));

		await fs.promises.rmdir(path);
	});
});
