import assert from 'node:assert';
import { suite, test } from 'node:test';
import { basename, dirname, extname, join, normalize, resolve } from '../src/emulation/path.js';

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
});
