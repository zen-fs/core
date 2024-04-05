import { FileSystem } from './filesystem.js';
import { ApiError, ErrorCode } from './ApiError.js';
import { dirname } from './emulation/path.js';
import { Cred } from './cred.js';

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

/** Waits n ms.  */
export function wait(ms: number): Promise<void> {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

/**
 * @hidden
 */
export const setImmediate = typeof globalThis.setImmediate == 'function' ? globalThis.setImmediate : cb => setTimeout(cb, 0);

/**
 * Encodes a string into a buffer
 * @internal
 */
export function encode(input: string, encoding: BufferEncoding = 'utf8'): Uint8Array {
	if (typeof input != 'string') {
		throw new ApiError(ErrorCode.EINVAL, 'Can not encode a non-string');
	}
	switch (encoding) {
		case 'ascii':
			return new Uint8Array(Array.from(input).map(char => char.charCodeAt(0) & 0x7f));
		case 'latin1':
		case 'binary':
			return new Uint8Array(Array.from(input).map(char => char.charCodeAt(0)));
		case 'utf8':
		case 'utf-8':
			return new Uint8Array(
				Array.from(input).flatMap(char => {
					const code = char.charCodeAt(0);
					if (code < 0x80) {
						return code;
					}

					const a = (code & 0x3f) | 0x80;
					if (code < 0x800) {
						return [(code >> 6) | 0xc0, a];
					}

					const b = ((code >> 6) & 0x3f) | 0x80;
					if (code < 0x10000) {
						return [(code >> 12) | 0xe0, b, a];
					}

					return [(code >> 18) | 0xf0, ((code >> 12) & 0x3f) | 0x80, b, a];
				})
			);
		case 'base64':
			return encode(atob(input), 'binary');
		case 'base64url':
			return encode(input.replace('_', '/').replace('-', '+'), 'base64');
		case 'hex':
			return new Uint8Array(input.match(/.{1,2}/g).map(e => parseInt(e, 16)));
		case 'utf16le':
		case 'ucs2':
		case 'ucs-2':
			const u16 = new Uint16Array(new ArrayBuffer(input.length * 2));
			for (let i = 0; i < input.length; i++) {
				u16[i] = input.charCodeAt(i);
			}
			return new Uint8Array(u16.buffer);
		default:
			throw new ApiError(ErrorCode.EINVAL, 'Invalid encoding: ' + encoding);
	}
}

/**
 * Decodes a string from a buffer
 * @internal
 */
export function decode(input?: Uint8Array, encoding: BufferEncoding = 'utf8'): string {
	if (!(input instanceof Uint8Array)) {
		throw new ApiError(ErrorCode.EINVAL, 'Can not decode a non-Uint8Array');
	}
	switch (encoding) {
		case 'ascii':
			return Array.from(input)
				.map(char => String.fromCharCode(char & 0x7f))
				.join('');
		case 'latin1':
		case 'binary':
			return Array.from(input)
				.map(char => String.fromCharCode(char))
				.join('');
		case 'utf8':
		case 'utf-8':
			let utf8String = '';
			for (let i = 0; i < input.length; i++) {
				let code;

				if (input[i] < 0x80) {
					code = input[i];
				} else if (input[i] < 0xe0) {
					code = ((input[i] & 0x1f) << 6) | (input[++i] & 0x3f);
				} else if (input[i] < 0xf0) {
					code = ((input[i] & 0x0f) << 12) | ((input[++i] & 0x3f) << 6) | (input[++i] & 0x3f);
				} else {
					code = ((input[i] & 0x07) << 18) | ((input[++i] & 0x3f) << 12) | ((input[++i] & 0x3f) << 6) | (input[++i] & 0x3f);
				}

				utf8String += String.fromCharCode(code);
			}
			return utf8String;
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
			return btoa(decode(input, 'binary'));
		case 'base64url':
			return decode(input, 'base64').replace('/', '_').replace('+', '-');
		case 'hex':
			return Array.from(input)
				.map(e => e.toString(16).padStart(2, '0'))
				.join('');
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
