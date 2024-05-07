import type { OptionalTuple } from 'utilium';
import { ApiError, ErrorCode } from './ApiError.js';
import { Cred } from './cred.js';
import { dirname, resolve } from './emulation/path.js';
import { FileSystem } from './filesystem.js';

declare global {
	function atob(data: string): string;
	function btoa(data: string): string;
}

declare const globalThis: {
	setImmediate?: (callback: () => unknown) => void;
};

/**
 * Synchronous recursive makedir.
 * @hidden
 */
export function mkdirpSync(p: string, mode: number, cred: Cred, fs: FileSystem): void {
	if (!fs.existsSync(p, cred)) {
		mkdirpSync(dirname(p), mode, cred, fs);
		fs.mkdirSync(p, mode, cred);
	}
}

function _min(d0: number, d1: number, d2: number, bx: number, ay: number): number {
	return Math.min(d0 + 1, d1 + 1, d2 + 1, bx === ay ? d1 : d1 + 1);
}

/**
 * Calculates levenshtein distance.
 * @hidden
 */
export function levenshtein(a: string, b: string): number {
	if (a === b) {
		return 0;
	}

	if (a.length > b.length) {
		[a, b] = [b, a]; // Swap a and b
	}

	let la = a.length;
	let lb = b.length;

	// Trim common suffix
	while (la > 0 && a.charCodeAt(la - 1) === b.charCodeAt(lb - 1)) {
		la--;
		lb--;
	}

	let offset = 0;

	// Trim common prefix
	while (offset < la && a.charCodeAt(offset) === b.charCodeAt(offset)) {
		offset++;
	}

	la -= offset;
	lb -= offset;

	if (la === 0 || lb === 1) {
		return lb;
	}

	const vector = new Array<number>(la << 1);

	for (let y = 0; y < la; ) {
		vector[la + y] = a.charCodeAt(offset + y);
		vector[y] = ++y;
	}

	let x: number;
	let d0: number;
	let d1: number;
	let d2: number;
	let d3: number;
	for (x = 0; x + 3 < lb; ) {
		const bx0 = b.charCodeAt(offset + (d0 = x));
		const bx1 = b.charCodeAt(offset + (d1 = x + 1));
		const bx2 = b.charCodeAt(offset + (d2 = x + 2));
		const bx3 = b.charCodeAt(offset + (d3 = x + 3));
		let dd = (x += 4);
		for (let y = 0; y < la; ) {
			const ay = vector[la + y];
			const dy = vector[y];
			d0 = _min(dy, d0, d1, bx0, ay);
			d1 = _min(d0, d1, d2, bx1, ay);
			d2 = _min(d1, d2, d3, bx2, ay);
			dd = _min(d2, d3, dd, bx3, ay);
			vector[y++] = dd;
			d3 = d2;
			d2 = d1;
			d1 = d0;
			d0 = dy;
		}
	}

	let dd: number = 0;
	for (; x < lb; ) {
		const bx0 = b.charCodeAt(offset + (d0 = x));
		dd = ++x;
		for (let y = 0; y < la; y++) {
			const dy = vector[y];
			vector[y] = dd = dy < d0 || dd < d0 ? (dy > dd ? dd + 1 : dy + 1) : bx0 === vector[la + y] ? d0 : d0 + 1;
			d0 = dy;
		}
	}

	return dd;
}

/**
 * @hidden
 */
export const setImmediate = typeof globalThis.setImmediate == 'function' ? globalThis.setImmediate : (cb: () => unknown) => setTimeout(cb, 0);

/**
 * Encodes a string into a buffer
 * @internal
 */
export function encode(input: string): Uint8Array {
	if (typeof input != 'string') {
		throw new ApiError(ErrorCode.EINVAL, 'Can not encode a non-string');
	}
	return new Uint8Array(Array.from(input).map(char => char.charCodeAt(0)));
}

/**
 * Decodes a string from a buffer
 * @internal
 */
export function decode(input?: Uint8Array): string {
	if (!(input instanceof Uint8Array)) {
		throw new ApiError(ErrorCode.EINVAL, 'Can not decode a non-Uint8Array');
	}

	return Array.from(input)
		.map(char => String.fromCharCode(char))
		.join('');
}

/**
 * Decodes a directory listing
 * @hidden
 */
export function decodeDirListing(data: Uint8Array): Record<string, bigint> {
	return JSON.parse(decode(data), (k, v) => {
		if (k == '') {
			return v;
		}

		return BigInt(v);
	});
}

/**
 * Encodes a directory listing
 * @hidden
 */
export function encodeDirListing(data: Record<string, bigint>): Uint8Array {
	return encode(
		JSON.stringify(data, (k, v) => {
			if (k == '') {
				return v;
			}

			return v.toString();
		})
	);
}

export type Callback<Args extends unknown[] = []> = (e?: ApiError, ...args: OptionalTuple<Args>) => unknown;

import type { EncodingOption, OpenMode, PathLike, WriteFileOptions } from 'node:fs';

/**
 * converts Date or number to a integer UNIX timestamp
 * Grabbed from NodeJS sources (lib/fs.js)
 *
 * @internal
 */
export function _toUnixTimestamp(time: Date | number): number {
	if (typeof time === 'number') {
		return Math.floor(time);
	}
	if (time instanceof Date) {
		return Math.floor(time.getTime() / 1000);
	}
	throw new Error('Cannot parse time: ' + time);
}

/**
 * Normalizes a mode
 * @internal
 */
export function normalizeMode(mode: string | number | unknown, def?: number): number {
	if (typeof mode == 'number') {
		return mode;
	}

	if (typeof mode == 'string') {
		const parsed = parseInt(mode, 8);
		if (!isNaN(parsed)) {
			return parsed;
		}
	}

	if (typeof def == 'number') {
		return def;
	}

	throw new ApiError(ErrorCode.EINVAL, 'Invalid mode: ' + mode?.toString());
}

/**
 * Normalizes a time
 * @internal
 */
export function normalizeTime(time: string | number | Date): Date {
	if (time instanceof Date) {
		return time;
	}

	if (typeof time == 'number') {
		return new Date(time * 1000);
	}

	if (typeof time == 'string') {
		return new Date(time);
	}

	throw new ApiError(ErrorCode.EINVAL, 'Invalid time.');
}

/**
 * Normalizes a path
 * @internal
 */
export function normalizePath(p: PathLike): string {
	p = p.toString();
	// Node doesn't allow null characters in paths.
	if (p.includes('\x00')) {
		throw new ApiError(ErrorCode.EINVAL, 'Path must be a string without null bytes.');
	}
	if (p.length == 0) {
		throw new ApiError(ErrorCode.EINVAL, 'Path must not be empty.');
	}
	return resolve(p.replaceAll(/[/\\]+/g, '/'));
}

/**
 * Normalizes options
 * @param options options to normalize
 * @param encoding default encoding
 * @param flag default flag
 * @param mode default mode
 * @internal
 */
export function normalizeOptions(
	options: WriteFileOptions | (EncodingOption & { flag?: OpenMode }) | undefined,
	encoding: BufferEncoding | null = 'utf8',
	flag: string,
	mode: number = 0
): { encoding?: BufferEncoding | null; flag: string; mode: number } {
	if (typeof options != 'object' || options === null) {
		return {
			encoding: typeof options == 'string' ? options : encoding ?? null,
			flag,
			mode,
		};
	}

	return {
		encoding: typeof options?.encoding == 'string' ? options.encoding : encoding ?? null,
		flag: typeof options?.flag == 'string' ? options.flag : flag,
		mode: normalizeMode('mode' in options ? options?.mode : null, mode),
	};
}

/**
 * Do nothing
 * @internal
 */
export function nop() {
	// do nothing
}
