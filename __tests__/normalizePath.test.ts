import { ApiError, ErrorCode } from '../src/ApiError';
import { normalizePath } from '../src/emulation/shared';

describe('normalizePath', () => {
	test('null bytes not allowed', () => {
		expect(() => normalizePath('foo\x00bar')).toThrow(new ApiError(ErrorCode.EINVAL, 'Path must be a string without null bytes.'));
	});

	test('absolute path resolution', () => {
		expect(normalizePath('something')).toEqual('/something');
	});

	test('backslash conversion', () => {
		expect(normalizePath('\\some\\windows\\path')).toEqual('/some/windows/path');
	});
});
