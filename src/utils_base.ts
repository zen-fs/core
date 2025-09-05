import { withErrno, type Exception } from 'kerium';
import type * as fs from 'node:fs';
import type { Worker as NodeWorker } from 'node:worker_threads';
import { decodeUTF8, encodeUTF8, type OptionalTuple } from 'utilium';

// NOTE: without utils_base.ts, there is a circular dependency with utils.ts and path.ts

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

export type Callback<Args extends unknown[] = [], NoError = undefined | void> = (e: Exception | NoError, ...args: OptionalTuple<Args>) => unknown;

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
 * Normalizes a time
 * @internal
 */
export function normalizeTime(time: string | number | Date): number {
	if (time instanceof Date) return time.getTime();

	try {
		return Number(time);
	} catch {
		throw withErrno('EINVAL', 'Invalid time.');
	}
}

/**
 * TypeScript is dumb, so we need to assert the type of a value sometimes.
 * For example, after calling `normalizePath`, TS still thinks the type is `PathLike` and not `string`.
 * @internal @hidden
 */
export function __assertType<T>(value: unknown): asserts value is T {}

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
	pattern = pattern
		.replace(/([.?+^$(){}|[\]/])/g, '$1')
		.replace(/\*\*/g, '.*')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '.');
	return new RegExp(`^${pattern}$`);
}

export async function waitOnline(worker: NodeWorker): Promise<void> {
	const online = Promise.withResolvers<void>();
	setTimeout(() => online.reject(withErrno('ETIMEDOUT')), 500);
	worker.on('online', online.resolve);
	await online.promise;
}