/**
 * Grab bag of utility functions used across the code.
 */
import { FileSystem } from './filesystem.js';
import { ApiError, ErrorCode } from './ApiError.js';
import * as path from './emulation/path.js';
import { Cred } from './cred.js';

declare global {
	function setImmediate(callback: () => unknown): void;
	function atob(data: string): string;
	function btoa(data: string): string;
}

/**
 * Synchronous recursive makedir.
 * @internal
 */
export function mkdirpSync(p: string, mode: number, cred: Cred, fs: FileSystem): void {
	if (!fs.existsSync(p, cred)) {
		mkdirpSync(path.dirname(p), mode, cred, fs);
		fs.mkdirSync(p, mode, cred);
	}
}

/*
 * Levenshtein distance, from the `js-levenshtein` NPM module.
 * Copied here to avoid complexity of adding another CommonJS module dependency.
 */

function _min(d0: number, d1: number, d2: number, bx: number, ay: number): number {
	return Math.min(d0 + 1, d1 + 1, d2 + 1, bx === ay ? d1 : d1 + 1);
}

/**
 * Calculates levenshtein distance.
 * @internal
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

/** Waits n ms.  */
export function wait(ms: number): Promise<void> {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

/**
 * Converts a callback into a promise. Assumes last parameter is the callback
 * @todo Look at changing resolve value from cbArgs[0] to include other callback arguments?
 */
export function toPromise(fn: (...fnArgs: unknown[]) => unknown) {
	return function (...args: unknown[]): Promise<unknown> {
		return new Promise((resolve, reject) => {
			args.push((e: ApiError, ...cbArgs: unknown[]) => {
				if (e) {
					reject(e);
				} else {
					resolve(cbArgs[0]);
				}
			});
			fn(...args);
		});
	};
}

/**
 * @internal
 */
export const setImmediate = typeof globalThis.setImmediate == 'function' ? globalThis.setImmediate : cb => setTimeout(cb, 0);

/**
 * Encodes a string into a buffer
 * @internal
 */
export function encode(input: string, encoding: BufferEncoding = 'utf8'): Uint8Array {
	switch (encoding) {
		case 'ascii':
		case 'utf8':
		case 'utf-8':
		case 'latin1':
		case 'binary':
			return new Uint8Array(Array.from(input).map(v => v.charCodeAt(0)));
		case 'utf16le':
		case 'ucs2':
		case 'ucs-2':
			return new Uint8Array(
				Array.from(input)
					.map(char => char.charCodeAt(0))
					.flatMap(code => [code & 0xff, (code >> 8) & 0xff])
			);
		case 'base64':
			return new Uint8Array(Array.from(btoa(input)).map(v => v.charCodeAt(0)));
		case 'base64url':
			return new Uint8Array(Array.from(btoa(input).replace('/', '_').replace('+', '-')).map(v => v.charCodeAt(0)));
		case 'hex':
			const hexBytes = [];
			for (let i = 0; i < input.length; i += 2) {
				hexBytes.push(parseInt(input.slice(i, 2), 16));
			}
			return new Uint8Array(hexBytes);
		default:
			throw new ApiError(ErrorCode.EINVAL, 'Invalid encoding: ' + encoding);
	}
}

/**
 * Decodes a string from a buffer
 * @internal
 */
export function decode(input?: Uint8Array, encoding: BufferEncoding = 'utf8'): string {
	switch (encoding) {
		case 'ascii':
		case 'utf8':
		case 'utf-8':
		case 'latin1':
		case 'binary':
			return Array.from(input)
				.map(v => String.fromCharCode(v))
				.join('');
		case 'utf16le':
		case 'ucs2':
		case 'ucs-2':
			let utf16leString = '';
			for (let i = 0; i < input.length; i += 2) {
				const code = input[i] | (input[i + 1] << 8);
				utf16leString += String.fromCharCode(code);
			}
			return utf16leString;
		case 'base64':
			return atob(
				Array.from(input)
					.map(v => String.fromCharCode(v))
					.join('')
			);
		case 'base64url':
			return atob(
				Array.from(input)
					.map(v => String.fromCharCode(v))
					.join('')
					.replace('_', '/')
					.replace('-', '+')
			);
		case 'hex':
			let hexString = '';
			for (let i = 0; i < input.length; i += 2) {
				const byte = (input[i] << 4) | input[i + 1];
				hexString += String.fromCharCode(byte);
			}
			return hexString;
		default:
			throw new ApiError(ErrorCode.EINVAL, 'Invalid encoding: ' + encoding);
	}
}

/**
 * Decodes a directory listing
 * @internal
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
 * @internal
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
