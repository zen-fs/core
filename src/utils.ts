/* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-return */
import type * as fs from 'node:fs';
import type { ClassLike, OptionalTuple } from 'utilium';
import { dirname, resolve, type AbsolutePath } from './emulation/path.js';
import { Errno, ErrnoError } from './error.js';
import type { FileSystem } from './filesystem.js';

declare global {
	function atob(data: string): string;
	function btoa(data: string): string;
}

/**
 * Synchronous recursive makedir.
 * @hidden
 */
export function mkdirpSync(path: string, mode: number, fs: FileSystem): void {
	if (!fs.existsSync(path)) {
		mkdirpSync(dirname(path), mode, fs);
		fs.mkdirSync(path, mode);
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
 * Encodes a string into a buffer
 * @internal
 */
export function encodeRaw(input: string): Uint8Array {
	if (typeof input != 'string') {
		throw new ErrnoError(Errno.EINVAL, 'Can not encode a non-string');
	}
	return new Uint8Array(Array.from(input).map(char => char.charCodeAt(0)));
}

/**
 * Decodes a string from a buffer
 * @internal
 */
export function decodeRaw(input?: Uint8Array): string {
	if (!(input instanceof Uint8Array)) {
		throw new ErrnoError(Errno.EINVAL, 'Can not decode a non-Uint8Array');
	}

	return Array.from(input)
		.map(char => String.fromCharCode(char))
		.join('');
}

const encoder = new TextEncoder();

/**
 * Encodes a string into a buffer
 * @internal
 */
export function encodeUTF8(input: string): Uint8Array {
	if (typeof input != 'string') {
		throw new ErrnoError(Errno.EINVAL, 'Can not encode a non-string');
	}
	return encoder.encode(input);
}

export { /** @deprecated @hidden */ encodeUTF8 as encode };

const decoder = new TextDecoder();

/**
 * Decodes a string from a buffer
 * @internal
 */
export function decodeUTF8(input?: Uint8Array): string {
	if (!(input instanceof Uint8Array)) {
		throw new ErrnoError(Errno.EINVAL, 'Can not decode a non-Uint8Array');
	}

	return decoder.decode(input);
}

export { /** @deprecated @hidden */ decodeUTF8 as decode };

/**
 * Decodes a directory listing
 * @hidden
 */
export function decodeDirListing(data: Uint8Array): Record<string, bigint> {
	return JSON.parse(decodeUTF8(data), (k, v) => (k == '' ? v : BigInt(v as string)));
}

/**
 * Encodes a directory listing
 * @hidden
 */
export function encodeDirListing(data: Record<string, bigint>): Uint8Array {
	return encodeUTF8(JSON.stringify(data, (k, v) => (k == '' ? v : v.toString())));
}

export type Callback<Args extends unknown[] = []> = (e?: ErrnoError, ...args: OptionalTuple<Args>) => unknown;

/**
 * Normalizes a mode
 * @internal
 */
export function normalizeMode(mode: unknown, def?: number): number {
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

	throw new ErrnoError(Errno.EINVAL, 'Invalid mode: ' + mode?.toString());
}

/**
 * Normalizes a time
 * @internal
 */
export function normalizeTime(time: string | number | Date): Date {
	if (time instanceof Date) {
		return time;
	}

	try {
		return new Date(time);
	} catch {
		throw new ErrnoError(Errno.EINVAL, 'Invalid time.');
	}
}

/**
 * Normalizes a path
 * @internal
 */
export function normalizePath(p: fs.PathLike): AbsolutePath {
	p = p.toString();
	if (p.includes('\x00')) {
		throw new ErrnoError(Errno.EINVAL, 'Path can not contain null character');
	}
	if (p.length == 0) {
		throw new ErrnoError(Errno.EINVAL, 'Path can not be empty');
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
	options: fs.WriteFileOptions | (fs.EncodingOption & { flag?: fs.OpenMode }) | undefined,
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

export type Concrete<T extends ClassLike> = Pick<T, keyof T> & (new (...args: any[]) => InstanceType<T>);
