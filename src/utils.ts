import type * as fs from 'node:fs';
import type { ClassLike, OptionalTuple } from 'utilium';
import { randomHex } from 'utilium';
import { Errno, ErrnoError } from './error.js';
import type { AbsolutePath } from './vfs/path.js';
import { resolve } from './vfs/path.js';

declare global {
	function atob(data: string): string;
	function btoa(data: string): string;
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

/* node:coverage disable */
export { /** @deprecated @hidden */ encodeUTF8 as encode };
/* node:coverage enable */

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

/* node:coverage disable */
export { /** @deprecated @hidden */ decodeUTF8 as decode };
/* node:coverage enable */

/**
 * Decodes a directory listing
 * @hidden
 */
export function decodeDirListing(data: Uint8Array): Record<string, number> {
	return JSON.parse(decodeUTF8(data), (k, v) => (k == '' ? v : typeof v == 'string' ? BigInt(v).toString(16).slice(0, Math.min(v.length, 8)) : (v as number)));
}

/**
 * Encodes a directory listing
 * @hidden
 */
export function encodeDirListing(data: Record<string, number>): Uint8Array {
	return encodeUTF8(JSON.stringify(data));
}

export type Callback<Args extends unknown[] = [], NoError = undefined | void> = (e: ErrnoError | NoError, ...args: OptionalTuple<Args>) => unknown;

/**
 * Normalizes a mode
 * @param def default
 * @internal
 */
export function normalizeMode(mode: unknown, def?: number): number {
	if (typeof mode == 'number') return mode;

	if (typeof mode == 'string') {
		const parsed = parseInt(mode, 8);
		if (!isNaN(parsed)) {
			return parsed;
		}
	}

	if (typeof def == 'number') return def;

	throw new ErrnoError(Errno.EINVAL, 'Invalid mode: ' + mode?.toString());
}

/**
 * Normalizes a time
 * @internal
 */
export function normalizeTime(time: string | number | Date): number {
	if (time instanceof Date) return time.getTime();

	try {
		return Number(time);
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

/**
 * Generate a random ino
 * @internal @deprecated @hidden
 */
export function randomBigInt(): bigint {
	return BigInt('0x' + randomHex(8));
}

/**
 * Prevents infinite loops
 * @internal
 */
export function canary(path?: string, syscall?: string) {
	const timeout = setTimeout(() => {
		throw ErrnoError.With('EDEADLK', path, syscall);
	}, 5000);

	return () => clearTimeout(timeout);
}

/**
 * A wrapper for throwing things.
 * Used in expressions.
 * @todo Remove once `throw` is allowed in expressions
 * @see https://github.com/tc39/proposal-throw-expressions
 * @internal @hidden
 */
export function _throw(e: unknown): never {
	throw e;
}

interface ArrayBufferViewConstructor {
	readonly prototype: ArrayBufferView<ArrayBufferLike>;
	new (length: number): ArrayBufferView<ArrayBuffer>;
	new (array: ArrayLike<number>): ArrayBufferView<ArrayBuffer>;
	new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(buffer: TArrayBuffer, byteOffset?: number, length?: number): ArrayBufferView<TArrayBuffer>;
	new (array: ArrayLike<number> | ArrayBuffer): ArrayBufferView<ArrayBuffer>;
}

/**
 * Grows a buffer if it isn't large enough
 * @returns The original buffer if resized successfully, or a newly created buffer
 * @internal Not for external use!
 */
export function growBuffer<T extends ArrayBufferLike | ArrayBufferView>(buffer: T, newByteLength: number): T {
	if (buffer.byteLength >= newByteLength) return buffer;

	if (ArrayBuffer.isView(buffer)) {
		const newBuffer = growBuffer(buffer.buffer, newByteLength);
		return new (buffer.constructor as ArrayBufferViewConstructor)(newBuffer, buffer.byteOffset, newByteLength) as T;
	}

	const isShared = buffer instanceof SharedArrayBuffer;

	// Note: If true, the buffer must be resizable/growable because of the first check.
	if (buffer.maxByteLength > newByteLength) {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		isShared ? buffer.grow(newByteLength) : buffer.resize(newByteLength);
		return buffer;
	}

	if (isShared) {
		const newBuffer = new SharedArrayBuffer(newByteLength) as T & SharedArrayBuffer;
		new Uint8Array(newBuffer).set(new Uint8Array(buffer));
		return newBuffer;
	}

	try {
		return buffer.transfer(newByteLength) as T;
	} catch {
		const newBuffer = new ArrayBuffer(newByteLength) as T & ArrayBuffer;
		new Uint8Array(newBuffer).set(new Uint8Array(buffer));
		return newBuffer;
	}
}
