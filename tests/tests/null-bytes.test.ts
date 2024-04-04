import { ApiError, ErrorCode } from '../../src/ApiError';
import { normalizePath } from '../../src/emulation/shared';

describe('path validation', () => {
	test('null bytes not allowed', () => {
		expect(() => normalizePath('foo\x00bar')).toThrow(new ApiError(ErrorCode.EINVAL, 'Path must be a string without null bytes.'));
	});
});
