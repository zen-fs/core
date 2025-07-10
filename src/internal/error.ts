import { Exception, setUVMessage, type ExceptionJSON } from 'kerium';

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

export function wrap<const FS, const Prop extends keyof FS & string>(fs: FS, prop: Prop, path: string, dest?: string): FS[Prop] {
	const fn = fs[prop] as FS[Prop] & ((...args: any[]) => any);
	if (typeof fn !== 'function') throw new TypeError(`${prop} is not a function`);
	return function (...args: Parameters<typeof fn>) {
		try {
			return fn.call(fs, ...args);
		} catch (e: any) {
			throw setUVMessage(Object.assign(e, { path, dest, syscall: prop.endsWith('Sync') ? prop.slice(0, -4) : prop }));
		}
	} as FS[Prop];
}
