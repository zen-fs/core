import assert from 'node:assert';
import { suite, test } from 'node:test';
import { configure } from '../src/config.js';
import * as fs from '../src/emulation/index.js';
import { InMemory } from '../src/index.js';

suite('Devices', () => {
	test('Mount in nested directory', async () => {
		await configure({
			mounts: {
				'/nested/dir': InMemory,
			},
		});

		assert.equal(fs.readdirSync('/').length, 1);
	});
});
