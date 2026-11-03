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

	test('matchesGlob does not backtrack exponentially', () => {
		const start = performance.now();
		assert(!matchesGlob('**/a/**/a/**/b', Array(5000).fill('a').join('/') + '/c'));
		assert(!matchesGlob('*a*a*a*a*b', 'a'.repeat(5000) + 'c'));
		assert(performance.now() - start < 1000);
	});
});
