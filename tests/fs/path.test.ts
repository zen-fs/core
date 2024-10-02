import assert from 'node:assert';
import { suite, test } from 'node:test';
import { basename, dirname, extname, join, normalize, resolve } from '../../src/emulation/path.js';

suite('Path emulation', () => {
	test('resolve', () => {
		assert(resolve('somepath') === '/somepath');
		assert(resolve('/another', 'path') === '/another/path');
	});

	test('join', () => {
		assert(join('/path', 'to', 'file.txt') === '/path/to/file.txt');
		assert(join('/path/', 'to', '/file.txt') === '/path/to/file.txt');
	});

	test('normalize', () => {
		assert(normalize('/path/to/../file.txt') === '/path/file.txt');
		assert(normalize('/path/to/./file.txt') === '/path/to/file.txt');
	});

	test('basename', () => {
		assert(basename('/path/to/file.txt') === 'file.txt');
		assert(basename('/path/to/file.txt', '.txt') === 'file');
	});

	test('dirname', () => {
		assert(dirname('/path/to/file.txt') === '/path/to');
	});

	test('extname', () => {
		assert(extname('/path/to/file.txt') === '.txt');
		assert(extname('/path/to/file') === '');
	});
});
