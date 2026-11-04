// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { basename, dirname, extname, join, matchesGlob, normalize, resolve } from '@zenfs/core/path';
import { fs } from '@zenfs/core';

suite('Path emulation', () => {
	test('resolve', () => {
		assert.equal(resolve('somepath'), '/somepath');
		assert.equal(resolve('/another', 'path'), '/another/path');
	});

	test('join', () => {
		assert.equal(join('/path', 'to', 'file.txt'), '/path/to/file.txt');
		assert.equal(join('/path/', 'to', '/file.txt'), '/path/to/file.txt');
	});

	test('normalize', () => {
		assert.equal(normalize('/path/to/../file.txt'), '/path/file.txt');
		assert.equal(normalize('/path/to/./file.txt'), '/path/to/file.txt');
	});

	test('basename', () => {
		assert.equal(basename('/path/to/file.txt'), 'file.txt');
		assert.equal(basename('/path/to/file.txt', '.txt'), 'file');
	});

	test('dirname', () => {
		assert.equal(dirname('/path/to/file.txt'), '/path/to');
	});

	test('extname', () => {
		assert.equal(extname('/path/to/file.txt'), '.txt');
		assert.equal(extname('/path/to/file'), '');
	});

	test('file:// URL (string)', () => {
		fs.writeFileSync('/example.txt', 'Yay');
		assert.equal(fs.readFileSync('file:///example.txt', 'utf-8'), 'Yay');
	});

	test('file:// URL (URL)', () => {
		fs.writeFileSync('/example.txt', 'Yay');
		const url = new URL('file:///example.txt');
		assert.equal(fs.readFileSync(url, 'utf-8'), 'Yay');
	});

	test('matchesGlob', () => {
		assert(matchesGlob('**/x', 'x'));
		assert(matchesGlob('**/x', 'a/b/x'));
		assert(matchesGlob('a/**/b', 'a/b'));
		assert(matchesGlob('a/**/b', 'a/c/d/b'));
		assert(matchesGlob('x/**', 'x/a/b'));
		assert(!matchesGlob('x/**', 'x'));
		assert(matchesGlob('*.txt', 'a.txt'));
		assert(!matchesGlob('*.txt', 'a/b.txt'));
		assert(!matchesGlob('a?b', 'a/b'));
		assert(!matchesGlob('a**b', 'a/c/b'));
	});

	test('matchesGlob only matches dot files with a literal dot', () => {
		assert(!matchesGlob('*', '.env'));
		assert(matchesGlob('.*', '.env'));
		assert(!matchesGlob('a/*', 'a/.hidden'));
		assert(!matchesGlob('**', 'a/.hidden'));
		assert(!matchesGlob('a/**', 'a/.b'));
		assert(!matchesGlob('a/**/d', 'a/b/.c/d'));
		assert(matchesGlob('**/.hidden', 'a/.hidden'));
		assert(matchesGlob('.*/*', '.a/b'));
	});

	test('matchesGlob supports character classes', () => {
		assert(matchesGlob('file[0-9].txt', 'file1.txt'));
		assert(!matchesGlob('[!a]', 'a'));
		assert(matchesGlob('[^a]', 'b'));
		assert(matchesGlob('[]x]', ']'));
		assert(matchesGlob('[[:alpha:]]', 'é'));
		assert(!matchesGlob('[[:digit:]]', 'a'));
		assert(matchesGlob('a[', 'a['));
	});

	test('matchesGlob supports extended globs', () => {
		assert(matchesGlob('*.@(js|ts)', 'index.ts'));
		assert(matchesGlob('?(a)', ''));
		assert(!matchesGlob('?(a)', 'aa'));
		assert(matchesGlob('*(a)', 'aaa'));
		assert(!matchesGlob('+(a)', ''));
		assert(matchesGlob('!(*.js)', 'index.css'));
		assert(!matchesGlob('!(*.js)', 'index.js'));
		assert(matchesGlob('foo.!(bar)', 'foo.baz'));
		assert(matchesGlob('a@(b|c@(d|e))', 'ace'));
		assert(matchesGlob('@(.a|b)', '.a'));
	});

	test('matchesGlob expands braces', () => {
		assert(matchesGlob('src/*.{js,ts}', 'src/index.ts'));
		assert(matchesGlob('page{1..5}.html', 'page3.html'));
		assert(matchesGlob('{1..9..3}', '4'));
		assert(!matchesGlob('{1..9..3}', '5'));
		assert(matchesGlob('{01..12}', '07'));
		assert(matchesGlob('{a..e}', 'c'));
		assert(matchesGlob('a{b,{c,d}}', 'ad'));
		assert(matchesGlob('a{b}c', 'a{b}c'));
	});

	test('matchesGlob treats backslashes and repeated slashes as separators', () => {
		assert(matchesGlob('a\\b', 'a/b'));
		assert(matchesGlob('a//b', 'a/b'));
	});

	test('matchesGlob does not backtrack exponentially', () => {
		const start = performance.now();
		assert(!matchesGlob('**/a/**/a/**/b', Array(5000).fill('a').join('/') + '/c'));
		assert(!matchesGlob('*a*a*a*a*b', 'a'.repeat(5000) + 'c'));
		assert(performance.now() - start < 1000);
	});
});
