// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs, config } from '../common.ts';

const content = 'Sample content',
	original = 'ABCD';

suite('Appends', config('appends'), () => {
	test('Create an empty file and add content', config('async'), async () => {
		const filename = 'append.txt';
		await fs.promises.appendFile(filename, content);
		const data = await fs.promises.readFile(filename, 'utf8');
		assert.equal(data, content);
	});

	test('Append data to a non-empty file', config('async'), async () => {
		const filename = 'append2.txt';

		await fs.promises.writeFile(filename, original);
		await fs.promises.appendFile(filename, content);
		const data = await fs.promises.readFile(filename, 'utf8');
		assert.equal(data, original + content);
	});

	test('Append a buffer to the file', config('async'), async () => {
		const filename = 'append3.txt';

		await fs.promises.writeFile(filename, original);
		await fs.promises.appendFile(filename, content);
		const data = await fs.promises.readFile(filename, 'utf8');
		assert.equal(data, original + content);
	});
});
