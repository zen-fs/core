import { getByString, type ExtractProperties } from 'utilium';
import * as fs from './emulation/index.js';
import type { AbsolutePath } from './emulation/path.js';
import { credentials, type Credentials } from './credentials.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn_FS = keyof ExtractProperties<typeof fs, (...args: any[]) => any>;
type Fn_Promises = keyof ExtractProperties<typeof fs.promises, (...args: any[]) => any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

type FnName = Fn_FS | `promises.${Fn_Promises}`;
type Fn<T extends FnName> = T extends `promises.${infer U extends Fn_Promises}` ? (typeof fs.promises)[U] : T extends Fn_FS ? (typeof fs)[T] : never;

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * Not implemented.
 * @experimental
 */
export interface FSContext {
	readonly root: AbsolutePath;
	readonly creds: Credentials;

	call<const K extends FnName>(method: K, ...args: Parameters<Fn<K>>): ReturnType<Fn<K>>;
}

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * Not implemented.
 * @experimental
 */
export function createContext(root: AbsolutePath, creds: Credentials = credentials): FSContext {
	return {
		root,
		creds,
		call<const K extends FnName>(method: K, ...args: Parameters<Fn<K>>): ReturnType<Fn<K>> {
			// @ts-expect-error 2349
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const value = getByString(fs, method)(...args);

			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return value;
		},
	};
}
