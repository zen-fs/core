import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

suite('Opening files', () => {
	const filename = 'a.js';

	test('throw ENOENT when opening non-existent file', async () => {
		assert.throws(() => fs.openSync('/path/to/file/that/does/not/exist', 'r'), { code: 'ENOENT' });
		await assert.rejects(fs.promises.open('/path/to/file/that/does/not/exist', 'r'), { code: 'ENOENT' });
	});

	test('open file with mode "r"', async () => {
		const { fd } = await fs.promises.open(filename, 'r');
		assert(fd >= -Infinity);
	});

	test('open file with mode "rs"', async () => {
		const { fd } = await fs.promises.open(filename, 'rs');
		assert(fd >= -Infinity);
	});
});
