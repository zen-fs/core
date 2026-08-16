// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.ts';

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
fs.symlinkSync('sub', '/glob/link');
fs.symlinkSync('/glob/nowhere', '/glob/dangling');

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

	test('cwd option', () => {
		const results = fs.globSync('*', { cwd: '/glob' });
		assert(results.includes('a.txt'), 'results should be relative to cwd');
		assert(results.includes('sub'));
		assert(!results.includes('glob/a.txt'), 'results should not be relative to the root');
	});

	test('patterns are relative to cwd', () => {
		assert.deepEqual(fs.globSync('*.txt', { cwd: '/glob/sub' }), ['d.txt']);
		assert.deepEqual(fs.globSync('deep/*.txt', { cwd: '/glob/sub' }), ['deep/f.txt']);
	});

	test('absolute patterns are relative to cwd', () => {
		assert.deepEqual(fs.globSync('/glob/sub/*.txt', { cwd: '/glob' }), ['sub/d.txt']);
		assert.deepEqual(fs.globSync('/glob/sub/*.txt', { cwd: '/glob/sub' }), ['d.txt']);
	});

	test('exclude receives paths relative to cwd', () => {
		const seen: string[] = [];
		fs.globSync('*', {
			cwd: '/glob',
			exclude: path => {
				seen.push(path);
				return false;
			},
		});
		assert(seen.includes('a.txt'), 'should be given cwd-relative paths');
		assert(!seen.some(p => p.startsWith('/')), 'should not be given absolute paths');
	});

	test('globstar does not follow symlinks by default', () => {
		const results = fs.globSync('/glob/**/*.txt');
		assert(results.includes('glob/sub/d.txt'), 'should include the real directory');
		assert(!results.includes('glob/link/d.txt'), 'should not descend into a symlinked directory');
	});

	test('followSymlinks option', () => {
		const results = fs.globSync('/glob/**/*.txt', { followSymlinks: true });
		assert(results.includes('glob/link/d.txt'), 'should descend into a symlinked directory');
		assert(results.includes('glob/link/deep/f.txt'), 'should descend recursively');
		assert(results.includes('glob/sub/d.txt'), 'should still include the real directory');
	});

	test('a symlink named by the pattern is always descended into', () => {
		const results = fs.globSync('/glob/link/*.txt');
		assert(results.includes('glob/link/d.txt'), 'should not need followSymlinks when the pattern names the link');
	});

	test('the symlink itself is still matched', () => {
		for (const followSymlinks of [false, true]) {
			const results = fs.globSync('/glob/*', { followSymlinks });
			assert(results.includes('glob/link'), `should match the link itself (followSymlinks: ${followSymlinks})`);
		}
	});

	test('dangling symlinks do not throw', () => {
		const results = fs.globSync('/glob/**', { followSymlinks: true });
		assert(results.includes('glob/dangling'), 'should match a dangling link without following it');
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

	test('globstar does not follow symlinks by default', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/**/*.txt'));
		assert(results.includes('glob/sub/d.txt'));
		assert(!results.includes('glob/link/d.txt'), 'should not descend into a symlinked directory');
	});

	test('followSymlinks option', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/**/*.txt', { followSymlinks: true }));
		assert(results.includes('glob/link/d.txt'));
		assert(results.includes('glob/link/deep/f.txt'));
		assert(results.includes('glob/sub/d.txt'));
	});

	test('a symlink named by the pattern is always descended into', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/link/*.txt'));
		assert(results.includes('glob/link/d.txt'));
	});

	test('dangling symlinks do not throw', async () => {
		const results = await Array.fromAsync(fs.promises.glob('/glob/**', { followSymlinks: true }));
		assert(results.includes('glob/dangling'));
	});
});
