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
		assert(matchesGlob('x', '**/x'));
		assert(matchesGlob('a/b/x', '**/x'));
		assert(matchesGlob('a/b', 'a/**/b'));
		assert(matchesGlob('a/c/d/b', 'a/**/b'));
		assert(matchesGlob('x/a/b', 'x/**'));
		assert(!matchesGlob('x', 'x/**'));
		assert(matchesGlob('a.txt', '*.txt'));
		assert(!matchesGlob('a/b.txt', '*.txt'));
		assert(!matchesGlob('a/b', 'a?b'));
		assert(!matchesGlob('a/c/b', 'a**b'));
	});

	test('matchesGlob only matches dot files with a literal dot', () => {
		assert(!matchesGlob('.env', '*'));
		assert(matchesGlob('.env', '.*'));
		assert(!matchesGlob('a/.hidden', 'a/*'));
		assert(!matchesGlob('a/.hidden', '**'));
		assert(!matchesGlob('a/.b', 'a/**'));
		assert(!matchesGlob('a/b/.c/d', 'a/**/d'));
		assert(matchesGlob('a/.hidden', '**/.hidden'));
		assert(matchesGlob('.a/b', '.*/*'));
	});

	test('matchesGlob supports character classes', () => {
		assert(matchesGlob('file1.txt', 'file[0-9].txt'));
		assert(!matchesGlob('a', '[!a]'));
		assert(matchesGlob('b', '[^a]'));
		assert(matchesGlob(']', '[]x]'));
		assert(matchesGlob('é', '[[:alpha:]]'));
		assert(!matchesGlob('a', '[[:digit:]]'));
		assert(matchesGlob('a[', 'a['));
	});

	test('matchesGlob supports extended globs', () => {
		assert(matchesGlob('index.ts', '*.@(js|ts)'));
		assert(matchesGlob('', '?(a)'));
		assert(!matchesGlob('aa', '?(a)'));
		assert(matchesGlob('aaa', '*(a)'));
		assert(!matchesGlob('', '+(a)'));
		assert(matchesGlob('index.css', '!(*.js)'));
		assert(!matchesGlob('index.js', '!(*.js)'));
		assert(matchesGlob('foo.baz', 'foo.!(bar)'));
		assert(matchesGlob('ace', 'a@(b|c@(d|e))'));
		assert(matchesGlob('.a', '@(.a|b)'));
	});

	test('matchesGlob expands braces', () => {
		assert(matchesGlob('src/index.ts', 'src/*.{js,ts}'));
		assert(matchesGlob('page3.html', 'page{1..5}.html'));
		assert(matchesGlob('4', '{1..9..3}'));
		assert(!matchesGlob('5', '{1..9..3}'));
		assert(matchesGlob('07', '{01..12}'));
		assert(matchesGlob('c', '{a..e}'));
		assert(matchesGlob('ad', 'a{b,{c,d}}'));
		assert(matchesGlob('a{b}c', 'a{b}c'));
	});

	test('matchesGlob treats backslashes and repeated slashes as separators', () => {
		assert(matchesGlob('a/b', 'a\\b'));
		assert(matchesGlob('a/b', 'a//b'));
	});

	test('matchesGlob does not backtrack exponentially', { timeout: 1000 }, () => {
		const start = performance.now();
		assert(!matchesGlob(Array(5000).fill('a').join('/') + '/c', '**/a/**/a/**/b'));
		assert(!matchesGlob('a'.repeat(5000) + 'c', '*a*a*a*a*b'));
		assert(performance.now() - start < 1000);
	});
});
