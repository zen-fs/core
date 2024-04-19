import { resolve, join, normalize, basename, dirname, extname } from '../src/emulation/path';

describe('Path emulation', () => {
	test('resolve', () => {
		expect(resolve('somepath')).toBe('/somepath');
		expect(resolve('/another', 'path')).toBe('/another/path');
	});

	test('join', () => {
		expect(join('/path', 'to', 'file.txt')).toBe('/path/to/file.txt');
		expect(join('/path/', 'to', '/file.txt')).toBe('/path/to/file.txt');
	});

	test('normalize', () => {
		expect(normalize('/path/to/../file.txt')).toBe('/path/file.txt');
		expect(normalize('/path/to/./file.txt')).toBe('/path/to/file.txt');
	});

	test('basename', () => {
		expect(basename('/path/to/file.txt')).toBe('file.txt');
		expect(basename('/path/to/file.txt', '.txt')).toBe('file');
	});

	test('dirname', () => {
		expect(dirname('/path/to/file.txt')).toBe('/path/to');
	});

	test('extname', () => {
		expect(extname('/path/to/file.txt')).toBe('.txt');
		expect(extname('/path/to/file')).toBe('');
	});
});
