import { test, suite } from 'node:test';
import { fs } from '../common.js';
import assert from 'node:assert/strict';
import { basename } from 'node:path/posix';

await fs.promises.mkdir('/tmp');

suite('Temporary Directories', () => {
	test('mkdtempSync', () => {
		const path = fs.mkdtempSync('test-', { encoding: 'utf8' });

		assert.deepEqual(fs.readdirSync('/tmp'), [basename(path)]);

		fs.rmdirSync(path);
	});

	test('mkdtemp', async () => {
		const path = await fs.promises.mkdtemp('test-', { encoding: 'utf8' });

		assert.deepEqual(await fs.promises.readdir('/tmp'), [basename(path)]);

		await fs.promises.rmdir(path);
	});

	test('mkdtempDisposableSync', () => {
		using result = fs.mkdtempDisposableSync('test-', { encoding: 'utf8' });

		assert.deepEqual(fs.readdirSync('/tmp'), [basename(result.path)]);

		fs.rmdirSync(result.path);
	});

	test('mkdtempDisposable', async () => {
		await using result = await fs.promises.mkdtempDisposable('test-', { encoding: 'utf8' });

		assert.deepEqual(await fs.promises.readdir('/tmp'), [basename(result.path)]);

		await fs.promises.rmdir(result.path);
	});
});
