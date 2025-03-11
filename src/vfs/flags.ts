import { Errno, ErrnoError } from '../internal/error.js';
import * as c from './constants.js';

export const pattern = /[rwasx]{1,2}\+?/;

/**
 * @internal @hidden
 */
export function parse(flag: string | number): number {
	if (typeof flag == 'number') return flag;

	if (!pattern.test(flag)) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid flag string: ' + flag);
	}

	return toNumber(flag);
}

/**
 * @internal @hidden
 */
export function toString(flag: number): string {
	let string = flag & c.O_RDONLY ? 'r' : flag & c.O_APPEND ? 'a' : flag & c.O_TRUNC ? 'w' : '';

	if (flag & c.O_SYNC) string += 's';
	if (flag & c.O_EXCL) string += 'x';
	if (flag & c.O_RDWR) string += '+';

	return string;
}

/**
 * @internal @hidden
 */
export function toNumber(flag: string): number {
	if (!flag.includes('r') && !flag.includes('w') && !flag.includes('a')) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid flag string: ' + flag);
	}

	let n = flag.includes('r') ? c.O_RDONLY : c.O_CREAT;

	if (flag.includes('w')) n |= c.O_TRUNC;
	if (flag.includes('a')) n |= c.O_APPEND;

	if (flag.includes('+')) n |= c.O_RDWR;
	else if (!flag.includes('r')) n |= c.O_WRONLY;

	if (flag.includes('s')) n |= c.O_SYNC;
	if (flag.includes('x')) n |= c.O_EXCL;

	return n;
}

/**
 * Parses a flag as a mode (W_OK, R_OK, and/or X_OK)
 * @param flag the flag to parse
 * @internal @hidden
 */
export function toMode(flag: number): number {
	let mode = 0;
	if (!(flag & c.O_WRONLY)) mode |= c.R_OK;
	if (flag & c.O_WRONLY || flag & c.O_RDWR) mode |= c.W_OK;
	return mode;
}
