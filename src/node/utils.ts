// SPDX-License-Identifier: LGPL-3.0-or-later
import { Buffer } from 'buffer';
import { Errno, Exception, setUVMessage, withErrno } from 'kerium';
import type * as fs from 'node:fs';
import type { Stats } from './stats.js';
import { normalizePath } from '../utils.js';

/**
 * Describes a value the way Node's argument errors do, e.g. `type string ('x')`.
 */
function describe(value: unknown): string {
	if (value == null) return String(value);
	if (typeof value == 'function') return `function ${value.name}`;
	if (typeof value == 'object') return value.constructor?.name ? `an instance of ${value.constructor.name}` : String(value);
	if (typeof value == 'string') return `type string ('${value.length > 28 ? value.slice(0, 25) + '...' : value}')`;
	return `type ${typeof value} (${String(value)})`;
}

/**
 * Formats a value the way Node's `ERR_INVALID_ARG_VALUE` does.
 */
function inspect(value: unknown): string {
	return typeof value == 'string' ? `'${value}'` : String(value);
}

/**
 * Joins items like Node's error messages, e.g. `a, b, or c`.
 */
function list(items: readonly string[]): string {
	if (items.length < 3) return items.join(' or ');
	return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`;
}

/**
 * Creates Node's `ERR_INVALID_ARG_TYPE`.
 * @param expected Primitive types (e.g. `string`) and class names (e.g. `Buffer`).
 */
export function invalidArgumentType(name: string, expected: string | readonly string[], value: unknown): TypeError {
	const types: string[] = [],
		classes: string[] = [];
	for (const type of typeof expected == 'string' ? [expected] : expected) (/^[A-Z]/.test(type) ? classes : types).push(type);

	const kind = name.includes('.') ? 'property' : 'argument';
	const expectedTypes = types.length ? `${types.length > 1 ? 'one of type' : 'of type'} ${list(types)}` : '';
	const expectedClasses = classes.length ? `an instance of ${list(classes)}` : '';
	const description = [expectedTypes, expectedClasses].filter(Boolean).join(' or ');

	return Object.assign(new TypeError(`The "${name}" ${kind} must be ${description}. Received ${describe(value)}`), {
		code: 'ERR_INVALID_ARG_TYPE',
	});
}

/**
 * Creates Node's `ERR_INVALID_ARG_VALUE`.
 */
export function invalidArgumentValue(name: string, value: unknown, reason: string = 'is invalid'): TypeError {
	const kind = name.includes('.') ? 'property' : 'argument';
	return Object.assign(new TypeError(`The ${kind} '${name}' ${reason}. Received ${inspect(value)}`), { code: 'ERR_INVALID_ARG_VALUE' });
}

/**
 * Creates Node's `ERR_OUT_OF_RANGE`.
 * @param range What the value must be, e.g. `an integer`.
 */
export function outOfRange(name: string, range: string, value: unknown): RangeError {
	return Object.assign(new RangeError(`The value of "${name}" is out of range. It must be ${range}. Received ${String(value)}`), {
		code: 'ERR_OUT_OF_RANGE',
	});
}

interface TypeNames {
	string: string;
	number: number;
	boolean: boolean;
	object: object;
	function: (...args: any[]) => unknown;
	Buffer: Buffer;
	TypedArray: NodeJS.TypedArray;
	DataView: DataView;
	URL: URL;
	RegExp: RegExp;
}

const typeChecks: { [K in keyof TypeNames]: (value: unknown) => boolean } = {
	string: value => typeof value == 'string',
	number: value => typeof value == 'number',
	boolean: value => typeof value == 'boolean',
	object: value => typeof value == 'object' && value !== null,
	function: value => typeof value == 'function',
	Buffer: value => Buffer.isBuffer(value),
	TypedArray: value => ArrayBuffer.isView(value) && !(value instanceof DataView),
	DataView: value => value instanceof DataView,
	URL: value => value instanceof URL,
	RegExp: value => value instanceof RegExp,
};

/**
 * Throws Node's `ERR_INVALID_ARG_TYPE` unless `value` is one of the `expected` types.
 */
export function validateType<const T extends keyof TypeNames>(value: unknown, name: string, ...expected: T[]): asserts value is TypeNames[T] {
	if (!expected.some(type => typeChecks[type](value))) throw invalidArgumentType(name, expected, value);
}

/**
 * Throws Node's `ERR_INVALID_ARG_TYPE` unless `data` is a string or an `ArrayBufferView`.
 */
export function validateData(data: unknown, name: string = 'data'): asserts data is string | ArrayBufferView {
	validateType(data, name, 'string', 'Buffer', 'TypedArray', 'DataView');
}

/**
 * Throws Node's `ERR_OUT_OF_RANGE` unless `maxDepth` is `Infinity` or a non-negative integer.
 */
export function validateMaxDepth(maxDepth: number): void {
	if (maxDepth === Infinity || (Number.isSafeInteger(maxDepth) && maxDepth >= 0)) return;
	throw outOfRange('options.maxDepth', Number.isInteger(maxDepth) ? '>= 0 && <= 9007199254740991' : 'an integer', maxDepth);
}

/**
 * Whether an error means the path does not resolve to an entry. Used for `throwIfNoEntry`.
 */
export function isNoEntry(e: unknown): boolean {
	const { code } = (e ?? {}) as Exception;
	return code == 'ENOENT' || code == 'ENOTDIR';
}

/** The messages of Node's `SystemError`s, by code */
const systemErrorMessages = {
	ERR_FS_EISDIR: 'Path is a directory',
	ERR_FS_CP_DIR_TO_NON_DIR: 'Cannot overwrite non-directory with directory',
	ERR_FS_CP_NON_DIR_TO_DIR: 'Cannot overwrite directory with non-directory',
	ERR_FS_CP_EEXIST: 'Target already exists',
	ERR_FS_CP_EINVAL: 'Invalid src or dest',
	ERR_FS_CP_FIFO_PIPE: 'Cannot copy a FIFO pipe',
	ERR_FS_CP_SOCKET: 'Cannot copy a socket file',
	ERR_FS_CP_UNKNOWN: 'Cannot copy an unknown file type',
};

interface SystemErrorContext {
	code: keyof typeof Errno;
	message: string;
	syscall: string;
	path: string;
}

/**
 * Creates one of Node's `SystemError`s, which report an errno error under a Node error code.
 */
function systemError(code: keyof typeof systemErrorMessages, context: SystemErrorContext): Error {
	const { syscall, path } = context;
	const errno = Errno[context.code];
	return Object.assign(new Error(`${systemErrorMessages[code]}: ${syscall} returned ${context.code} (${context.message}) ${path}`), {
		name: 'SystemError',
		code,
		info: { ...context, errno },
		errno,
		syscall,
		path,
	});
}

/**
 * Creates Node's error for removing a directory with `rm` without `recursive`.
 */
export function rmDirectoryError(path: string): Error {
	return systemError('ERR_FS_EISDIR', { code: 'EISDIR', message: 'is a directory', syscall: 'rm', path });
}

/**
 * Creates one of the errors Node's `cp` throws.
 */
export function cpError(code: keyof typeof systemErrorMessages, errno: keyof typeof Errno, message: string, path: string): Error {
	return systemError(code, { code: errno, message, syscall: 'cp', path });
}

/**
 * Throws Node's errors for copying `source` onto `destination`: the same file, mismatched types, or a directory into itself.
 * @param sameFileSystem Whether both paths are on the same file system, since inode numbers are only unique within one.
 */
export function cpCheckPaths(
	source: string,
	destination: string,
	sameFileSystem: boolean,
	sourceStats: Stats,
	destinationStats?: Stats | void,
): void {
	const sourceIsDirectory = sourceStats.isDirectory();

	if (destinationStats) {
		if (sameFileSystem && sourceStats.ino == destinationStats.ino)
			throw cpError('ERR_FS_CP_EINVAL', 'EINVAL', 'src and dest cannot be the same', destination);

		if (sourceIsDirectory && !destinationStats.isDirectory())
			throw cpError(
				'ERR_FS_CP_DIR_TO_NON_DIR',
				'EISDIR',
				`cannot overwrite non-directory ${destination} with directory ${source}`,
				destination,
			);

		if (!sourceIsDirectory && destinationStats.isDirectory())
			throw cpError(
				'ERR_FS_CP_NON_DIR_TO_DIR',
				'ENOTDIR',
				`cannot overwrite directory ${destination} with non-directory ${source}`,
				destination,
			);
	}

	if (sourceIsDirectory && destination.startsWith(source == '/' ? source : source + '/'))
		throw cpError('ERR_FS_CP_EINVAL', 'EINVAL', `cannot copy ${source} to a subdirectory of self ${destination}`, destination);
}

/**
 * Creates the error `cp` throws for a file it cannot copy.
 */
export function cpSpecialFileError(stats: Stats, destination: string): Error {
	const [code, kind] = stats.isSocket()
		? (['ERR_FS_CP_SOCKET', 'a socket file'] as const)
		: stats.isFIFO()
			? (['ERR_FS_CP_FIFO_PIPE', 'a FIFO pipe'] as const)
			: (['ERR_FS_CP_UNKNOWN', 'an unknown file type'] as const);
	return cpError(code, 'EINVAL', `cannot copy ${kind}: ${destination}`, destination);
}

/**
 * Resolves the `buffer` option of `readFile` into a buffer covering the first `size` bytes of the view.
 */
export function readFileBuffer(into: ArrayBufferView | ((size: number) => ArrayBufferView), size: number): Buffer {
	const isFunction = typeof into == 'function';
	const view: unknown = isFunction ? into(size) : into;

	if (!ArrayBuffer.isView(view)) throw invalidArgumentType('options.buffer', ['function', 'Buffer', 'TypedArray', 'DataView'], view);

	if (view.byteLength < size)
		throw invalidArgumentValue(
			`${isFunction ? 'options.buffer()' : 'options.buffer'}.byteLength`,
			view.byteLength,
			`is smaller than the file size of ${size} bytes`,
		);

	return Buffer.from(view.buffer, view.byteOffset, size);
}

/**
 * Creates Node's `AbortError` for an aborted `signal`.
 */
function abortError(signal: AbortSignal): Error {
	return Object.assign(new Error('The operation was aborted', { cause: signal.reason }), { name: 'AbortError', code: 'ABORT_ERR' });
}

/**
 * Runs `operation`, rejecting with Node's `AbortError` if `signal` is aborted before it settles.
 */
export async function raceSignal<T>(operation: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
	if (!signal) return await operation();
	if (signal.aborted) throw abortError(signal);

	const { promise, reject } = Promise.withResolvers<never>();
	const onAbort = () => reject(abortError(signal));
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		return await Promise.race([operation(), promise]);
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

/**
 * Validates the options of `openAsBlob` like Node, returning the MIME type.
 */
export function blobType(options: unknown): string {
	validateType(options, 'options', 'object');
	const { type = '' } = options as { type?: unknown };
	validateType(type, 'options.type', 'string');
	return type;
}

/**
 * Normalizes the prefix of a temporary path, which may be empty.
 */
function normalizePrefix(prefix: fs.PathLike): string {
	return typeof prefix != 'number' && !(prefix instanceof URL) && !prefix.length ? '' : normalizePath(prefix, true);
}

export function tempDirName(prefix: fs.PathLike) {
	// Like Node, the prefix is a path. A relative one is resolved against the working directory, not `/tmp`.
	return `${normalizePrefix(prefix)}${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const tempFileCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Creates the path of a temporary file by appending six random characters to `prefix`, like Node's `mkstemp`.
 */
export function tempFileName(prefix: unknown): string {
	validateType(prefix, 'prefix', 'string', 'Buffer', 'URL');
	let name = normalizePrefix(prefix);
	for (const byte of crypto.getRandomValues(new Uint8Array(6))) name += tempFileCharacters[byte % tempFileCharacters.length];
	return name;
}

/**
 * Reports an error creating a temporary file against the `prefix` template, like Node's `mkstemp`.
 */
export function mkstempError(error: unknown, prefix: fs.PathLike): unknown {
	if (!(error instanceof Exception)) return error;
	return setUVMessage(Object.assign(error, { syscall: 'mkstemp', path: normalizePrefix(prefix) + 'XXXXXX' }));
}

/**
 * Encodes the path of a created temporary file or directory, which is a `Buffer` if `prefix` is one, like Node.
 */
export function tempResult(path: string, prefix: unknown, options?: fs.EncodingOption | fs.BufferEncodingOption): string | NonSharedBuffer {
	const encoding = typeof options == 'object' ? options?.encoding : options;
	if (Buffer.isBuffer(prefix) || encoding == 'buffer') return Buffer.from(path);
	if (!encoding || encoding == 'utf8' || encoding == 'utf-8') return path;
	return Buffer.from(path).toString(encoding);
}

/**
 * Resolves the global `Temporal`, which is not implemented by all runtimes.
 */
export function temporal(): typeof Temporal {
	if ('Temporal' in globalThis && typeof globalThis.Temporal !== 'undefined') return globalThis.Temporal;
	throw withErrno('ENOTSUP', 'Temporal is not supported by this runtime');
}
