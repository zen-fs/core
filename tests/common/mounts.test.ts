import assert from 'node:assert';
import { suite, test } from 'node:test';
import { configure } from '../../dist/config.js';
import * as fs from '../../dist/vfs/index.js';
import { InMemory, mounts } from '../../dist/index.js';

suite('Mounts', () => {
	test('Mount in nested directory', async () => {
		await configure({
			mounts: {
				'/nested/dir': InMemory,
			},
		});

		assert.deepStrictEqual(fs.readdirSync('/'), ['nested']);
		assert.deepStrictEqual(fs.readdirSync('/nested'), ['dir']);

		// cleanup
		fs.umount('/nested/dir');
		fs.rmSync('/nested', { recursive: true, force: true });
	});

	test('Race conditions', async () => {
		await configure({
			mounts: {
				one: InMemory,
				two: InMemory,
				three: InMemory,
				four: InMemory,
			},
		});

		assert.equal(mounts.size, 5); // 4 + default `/` mount
		assert.equal(fs.readdirSync('/').length, 4);
	});
});
