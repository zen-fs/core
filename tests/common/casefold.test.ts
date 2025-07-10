import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { mounts, configure, fs } from '../../dist/index.js';

suite('Case folding', () => {
	test('Configuration', async () => {
		await configure({ caseFold: 'lower' });
		assert.equal(mounts.get('/')?.attributes.get('case_fold'), 'lower');
	});

	test('Write', () => {
		fs.writeFileSync('/Test.txt', 'test');
		assert(fs.existsSync('/test.txt'));
	});

	test('Read', () => {
		assert.equal(fs.readFileSync('/TEST.txt', 'utf8'), 'test');
	});
});
