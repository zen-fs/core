// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno, type Exception } from 'kerium';
import type * as fs from 'node:fs';
import type { Worker as NodeWorker } from 'node:worker_threads';
import { decodeUTF8, encodeUTF8, type OptionalTuple } from 'utilium';
import { resolve } from './path.js';
import type { V_Context } from './internal/contexts.js';

declare global {
	function atob(data: string): string;
	function btoa(data: string): string;
}

/**
 * Decodes a directory listing
 * @hidden
 */
export function decodeDirListing(data: Uint8Array): Record<string, number> {
	return JSON.parse(decodeUTF8(data), (k, v) =>
		k == '' ? v : typeof v == 'string' ? BigInt(v).toString(16).slice(0, Math.min(v.length, 8)) : (v as number)
	);
}

/**
 * Encodes a directory listing
 * @hidden
 */
export function encodeDirListing(data: Record<string, number>): Uint8Array {
	return encodeUTF8(JSON.stringify(data));
}

export type Callback<Args extends unknown[] = [], NoError = null> = (e: Exception | NoError, ...args: OptionalTuple<Args>) => unknown;

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

	throw withErrno('EINVAL', 'Invalid mode: ' + mode?.toString());
}

/**
 * The largest valid file descriptor, since Node validates them as 32-bit signed integers
 * @internal @hidden
 */
const fd_max = 0x7fffffff;

/**
 * Checks that `fd` is in the range Node accepts for a file descriptor.
 * Note this throws a `RangeError` rather than an `Exception`, since that is what Node does.
 * @internal
 */
export function validateFD(fd: number): void {
	if (Number.isInteger(fd) && fd >= 0 && fd <= fd_max) return;

	throw Object.assign(new RangeError(`The value of "fd" is out of range. It must be >= 0 && <= ${fd_max}. Received ${fd}`), {
		code: 'ERR_OUT_OF_RANGE',
	});
}

/**
 * Normalizes a time to milliseconds since the epoch.
 * Note numbers and numeric strings are seconds, like Node's `toUnixTimestamp`.
 * @internal
 */
export function normalizeTime(time: fs.TimeLike): number {
	// Dates are already in milliseconds
	if (time instanceof Date) return time.getTime();

	const seconds = Number(time);

	if (!Number.isFinite(seconds)) throw withErrno('EINVAL', 'Invalid time.');

	// Negative times mean "now"
	return seconds < 0 ? Date.now() : seconds * 1000;
}

/**
 * Normalizes a path
 * @internal
 * @todo clean this up and make it so `path.resolve` is only called when an explicit context is passed (i.e. `normalizePath(..., $)` to use `path.resolve`)
 */
export function normalizePath(this: V_Context, p: fs.PathLike, noResolve: boolean = false): string {
	if (p instanceof URL) {
		if (p.protocol != 'file:') throw withErrno('EINVAL', 'URLs must use the file: protocol');
		p = p.pathname;
	}
	p = p.toString();
	if (p.startsWith('file://')) p = p.slice('file://'.length);
	if (p.includes('\x00')) throw withErrno('EINVAL', 'Path can not contain null character');
	if (p.length == 0) throw withErrno('EINVAL', 'Path can not be empty');
	p = p.replaceAll(/[/\\]+/g, '/');

	// Note: PWD is not resolved here, it is resolved later.
	return noResolve ? p : resolve.call(this, p);
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
): fs.ObjectEncodingOptions & { flag: string; mode: number } {
	if (typeof options != 'object' || options === null) {
		return {
			encoding: typeof options == 'string' ? options : (encoding ?? null),
			flag,
			mode,
		};
	}

	return {
		encoding: typeof options?.encoding == 'string' ? options.encoding : (encoding ?? null),
		flag: typeof options?.flag == 'string' ? options.flag : flag,
		mode: normalizeMode('mode' in options ? options?.mode : null, mode),
	};
}

/**
 * Converts a glob pattern to a regular expression
 * @internal
 */
export function globToRegex(pattern: string): RegExp {
	const GLOBSTAR = '\0GS\0';
	const STAR = '\0S\0';
	pattern = pattern
		.replace(/\*\*/g, GLOBSTAR)
		.replace(/\*/g, STAR)
		.replace(/[.+^$(){}|[\]\\]/g, '\\$&')
		.replace(/\?/g, '.')
		.replaceAll('/' + GLOBSTAR + '/', '(?:/.*)?/')
		.replaceAll(GLOBSTAR, '.*')
		.replaceAll(STAR, '[^/]*');
	return new RegExp(`^${pattern}$`);
}

export async function waitOnline(worker: NodeWorker): Promise<void> {
	const online = Promise.withResolvers<void>();
	setTimeout(() => online.reject(withErrno('ETIMEDOUT')), 500);
	worker.on('online', online.resolve);
	await online.promise;
}

/**
 * @internal @hidden
 */
export function _tempDirName(prefix: fs.PathLike) {
	// Like Node, the prefix is a path. A relative one is resolved against the working directory, not `/tmp`.
	return `${normalizePath(prefix, true)}${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Resolves the global `Temporal`, which is not implemented by all runtimes.
 * @internal @hidden
 */
export function _temporal(): typeof Temporal {
	if ('Temporal' in globalThis && typeof globalThis.Temporal !== 'undefined') return globalThis.Temporal;
	throw withErrno('ENOTSUP', 'Temporal is not supported by this runtime');
}
