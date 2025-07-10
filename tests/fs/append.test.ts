import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const content = 'Sample content',
	original = 'ABCD';

suite('Appends', () => {
	test('Create an empty file and add content', async () => {
		const filename = 'append.txt';
		await fs.promises.appendFile(filename, content);
		const data = await fs.promises.readFile(filename, 'utf8');
		assert.equal(data, content);
	});

	test('Append data to a non-empty file', async () => {
		const filename = 'append2.txt';

		await fs.promises.writeFile(filename, original);
		await fs.promises.appendFile(filename, content);
		const data = await fs.promises.readFile(filename, 'utf8');
		assert.equal(data, original + content);
	});

	test('Append a buffer to the file', async () => {
		const filename = 'append3.txt';

		await fs.promises.writeFile(filename, original);
		await fs.promises.appendFile(filename, content);
		const data = await fs.promises.readFile(filename, 'utf8');
		assert.equal(data, original + content);
	});
});
