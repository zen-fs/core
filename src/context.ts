/* eslint-disable @typescript-eslint/no-explicit-any */
import { getByString, type ExtractProperties } from 'utilium';
import * as fs from './emulation/index.js';
import type { AbsolutePath } from './emulation/path.js';
import { credentials as defaultCredentials, type Credentials } from './credentials.js';

type Fn_FS = Omit<ExtractProperties<typeof fs, (...args: any[]) => any>, 'mountObject'>;
type Fn_Promises = ExtractProperties<typeof fs.promises, (...args: any[]) => any>;

type FnName = keyof Fn_FS | `promises.${keyof Fn_Promises}`;
type Fn<T extends FnName> = T extends `promises.${infer U extends keyof Fn_Promises}` ? (typeof fs.promises)[U] : T extends keyof Fn_FS ? (typeof fs)[T] : never;

/**
 * Binds a this value for all of the functions in an object (not recursive)
 * @internal
 */
function _bindFunctions<T extends Record<string, unknown>>(fns: T, thisValue: any): T {
	return Object.fromEntries(Object.entries(fns).map(([k, v]) => [k, typeof v == 'function' ? v.bind(thisValue) : v])) as T;
}

export interface FSContext {
	readonly root: AbsolutePath;
	readonly credentials: Credentials;
}

export type V_Context = Partial<FSContext> | void | Record<string, unknown>;

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * @experimental
 */
export interface BoundContext extends Fn_FS, FSContext {
	call<const K extends FnName>(method: K, ...args: Parameters<Fn<K>>): ReturnType<Fn<K>>;

	promises: Fn_Promises;
}

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * @experimental
 */
export function bindContext(root: AbsolutePath, credentials: Credentials = defaultCredentials): BoundContext {
	const ctx = {
		root,
		credentials,
		call<const K extends FnName>(method: K, ...args: Parameters<Fn<K>>): ReturnType<Fn<K>> {
			// @ts-expect-error 2349
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const value = getByString(fs, method)(...args);

			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return value;
		},
	} satisfies FSContext & { call: any };

	const fn_fs = _bindFunctions<Fn_FS>(fs, ctx);
	const fn_promises = _bindFunctions<Fn_Promises>(fs.promises, ctx);

	return { ...ctx, ...fn_fs, promises: fn_promises };
}
