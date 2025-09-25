// SPDX-License-Identifier: LGPL-3.0-or-later
import { Errno, Exception, setUVMessage, UV, type ExceptionExtra, type ExceptionJSON } from 'kerium';
import type { FileSystem } from './filesystem.js';

/**
 * @deprecated Use {@link ExceptionJSON} instead
 * @category Internals
 */
export type ErrnoErrorJSON = ExceptionJSON;

/**
 * @deprecated Use {@link Exception} instead
 * @category Internals
 */
export const ErrnoError = Exception;

/**
 * @deprecated Use {@link Exception} instead
 * @category Internals
 */
export type ErrnoError = Exception;

export function withPath<E extends Exception>(e: E, path: string): E {
	e.path = path;
	return e;
}

/**
 * @internal @hidden
 */
export function wrap<const FS, const Prop extends keyof FS & string>(fs: FS, prop: Prop, path: string | ExceptionExtra, dest?: string): FS[Prop] {
	const extra = typeof path === 'string' ? { path, dest, syscall: prop.endsWith('Sync') ? prop.slice(0, -4) : prop } : path;
	const fn = fs[prop] as FS[Prop] & ((...args: any[]) => any);
	if (typeof fn !== 'function') throw new TypeError(`${prop} is not a function`);
	return function (...args: Parameters<typeof fn>) {
		try {
			return fn.call(fs, ...args);
		} catch (e: any) {
			throw setUVMessage(Object.assign(e, extra));
		}
	} as FS[Prop];
}

/**
 * @internal
 * Wraps an `fs` so that thrown errors aren't empty
 */
export function withExceptionContext<const FS extends FileSystem>(fs: FS, context: ExceptionExtra): FS {
	return new Proxy(fs, {
		get(target, prop: keyof FS & string, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value != 'function') return value;

			return function __withContext(...args: any[]) {
				try {
					const result = value.apply(receiver, args);
					if (!(result instanceof Promise)) return result;
					return result.catch((e: any) => {
						if ('code' in e) throw setUVMessage(Object.assign(e, context));
						if (e in Errno) {
							const ex = UV(e, context);
							Error.captureStackTrace(ex, __withContext);
						}
						throw e;
					});
				} catch (e: any) {
					throw setUVMessage(Object.assign(e, context));
				}
			};
		},
	});
}
