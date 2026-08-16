// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.ts';

suite('Opening files', () => {
	const filename = 'a.js';

	test('throw ENOENT when opening non-existent file', config('sync', 'async'), async () => {
		assert.throws(() => fs.openSync('/path/to/file/that/does/not/exist', 'r'), { code: 'ENOENT' });
		await assert.rejects(fs.promises.open('/path/to/file/that/does/not/exist', 'r'), { code: 'ENOENT' });
	});

	test('open file with mode "r"', config('async'), async () => {
		await using handle = await fs.promises.open(filename, 'r');
		assert(handle.fd >= -Infinity);
	});

	test('open file with mode "rs"', config('async'), async () => {
		await using handle = await fs.promises.open(filename, 'rs');
		assert(handle.fd >= -Infinity);
	});
});
