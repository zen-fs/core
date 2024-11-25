import assert from 'node:assert';
import { suite, test } from 'node:test';
import { configure } from '../dist/config.js';
import * as fs from '../dist/emulation/index.js';
import { InMemory } from '../dist/index.js';

suite('Mounts', () => {
	test('Mount in nested directory', async () => {
		await configure({
			mounts: {
				'/nested/dir': InMemory,
			},
		});

		assert.deepStrictEqual(fs.readdirSync('/'), ['nested']);
		assert.deepStrictEqual(fs.readdirSync('/nested'), ['dir']);
	});
});
