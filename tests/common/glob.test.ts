// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

// Set up a directory structure for glob tests
fs.mkdirSync('/glob');
fs.mkdirSync('/glob/sub');
fs.mkdirSync('/glob/sub/deep');
fs.writeFileSync('/glob/a.txt', 'a');
fs.writeFileSync('/glob/b.txt', 'b');
fs.writeFileSync('/glob/c.js', 'c');
fs.writeFileSync('/glob/sub/d.txt', 'd');
fs.writeFileSync('/glob/sub/e.js', 'e');
fs.writeFileSync('/glob/sub/deep/f.txt', 'f');

suite('globSync', () => {
	test('wildcard in root', () => {
		const results = fs.globSync('glob/*');
		assert(results.includes('glob/a.txt'), 'should include glob/a.txt');
		assert(results.includes('glob/b.txt'), 'should include glob/b.txt');
		assert(results.includes('glob/c.js'), 'should include glob/c.js');
		assert(results.includes('glob/sub'), 'should include glob/sub');
	});

	test('wildcard with absolute path pattern', () => {
		const results = fs.globSync('/glob/*');
		assert(results.includes('glob/a.txt'), 'should include glob/a.txt');
		assert(results.includes('glob/b.txt'), 'should include glob/b.txt');
		assert(results.includes('glob/c.js'), 'should include glob/c.js');
	});

	test('wildcard with extension filter', () => {
		const results = fs.globSync('/glob/*.txt');
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/b.txt'));
		assert(!results.includes('glob/c.js'), 'should not include .js files');
	});

	test('nested path wildcard', () => {
		const results = fs.globSync('/glob/sub/*');
		assert(results.includes('glob/sub/d.txt'));
		assert(results.includes('glob/sub/e.js'));
		assert(!results.includes('glob/a.txt'), 'should not include files from parent');
	});

	test('globstar (**)', () => {
		const results = fs.globSync('/glob/**/*.txt');
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/b.txt'));
		assert(results.includes('glob/sub/d.txt'));
		assert(results.includes('glob/sub/deep/f.txt'));
		assert(!results.includes('glob/c.js'), 'should not include .js files');
	});

	test('question mark wildcard', () => {
		const results = fs.globSync('/glob/?.txt');
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/b.txt'));
		assert(!results.includes('glob/c.js'));
	});

	test('multiple patterns', () => {
		const results = fs.globSync(['/glob/*.txt', '/glob/*.js']);
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/c.js'));
	});

	test('no matches returns empty', () => {
		const results = fs.globSync('/glob/*.xyz');
		assert.equal(results.length, 0);
	});

	test('withFileTypes option', () => {
		const results = fs.globSync('/glob/*.txt', { withFileTypes: true });
		assert(results.length > 0, 'should have results');
		assert(typeof results[0] === 'object' && 'name' in results[0], 'results should be Dirent objects');
	});

	test('exclude option with function', () => {
		const results = fs.globSync('/glob/*', { exclude: path => typeof path === 'string' && path.endsWith('.js') });
		assert(!results.includes('glob/c.js'), 'should exclude .js files');
		assert(results.includes('glob/a.txt'), 'should still include .txt files');
	});
});

await suite('promises.glob', () => {
	test('wildcard in root', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/*'));
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/b.txt'));
		assert(results.includes('glob/c.js'));
		assert(results.includes('glob/sub'));
	});

	test('wildcard with absolute path pattern', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/*'));
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/b.txt'));
	});

	test('wildcard with extension filter', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/*.txt'));
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/b.txt'));
		assert(!results.includes('glob/c.js'));
	});

	test('nested path wildcard', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/sub/*'));
		assert(results.includes('glob/sub/d.txt'));
		assert(results.includes('glob/sub/e.js'));
		assert(!results.includes('glob/a.txt'));
	});

	test('globstar (**)', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/**/*.txt'));
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/b.txt'));
		assert(results.includes('glob/sub/d.txt'));
		assert(results.includes('glob/sub/deep/f.txt'));
		assert(!results.includes('glob/c.js'));
	});

	test('multiple patterns', async () => {
		const results = await Array.fromAsync(fs.promises.glob(['/glob/*.txt', '/glob/*.js']));
		assert(results.includes('glob/a.txt'));
		assert(results.includes('glob/c.js'));
	});

	test('no matches returns empty', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/*.xyz'));
		assert.equal(results.length, 0);
	});
});
