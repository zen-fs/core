/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CredentialInit, Credentials } from './internal/credentials.js';
import { createCredentials, credentials as defaultCredentials } from './internal/credentials.js';
import * as path from './path.js';
import type { SyncHandle } from './vfs/file.js';
import * as fs from './vfs/index.js';

type Bound<T> = T & {
	[k in keyof T]: T[k] extends (...args: any[]) => any ? (this: FSContext, ...args: Parameters<T[k]>) => ReturnType<T[k]> : T[k];
};

/**
 * Binds a this value for all of the functions in an object (not recursive)
 * @internal
 */
function _bindFunctions<T extends Record<string, unknown>>(fns: T, thisValue: FSContext) {
	return Object.fromEntries(Object.entries(fns).map(([k, v]) => [k, typeof v == 'function' ? v.bind(thisValue) : v])) as Bound<T>;
}

/**
 * Represents some context used for FS operations
 * @category Backends and Configuration
 */
export interface FSContext {
	root: string;
	pwd: string;
	readonly credentials: Credentials;
	descriptors: Map<number, SyncHandle>;
}

/**
 * maybe an FS context
 */
export type V_Context = void | null | (Partial<FSContext> & object);

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * @category Backends and Configuration
 */
export interface BoundContext extends FSContext {
	fs: Bound<typeof fs> & { promises: Bound<typeof fs.promises>; xattr: Bound<typeof fs.xattr> };

	/** Path functions, bound to the context */
	path: Bound<typeof path>;
}

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * Note that the default credentials of a bound context are copied from the global credentials.
 * @category Backends and Configuration
 */
export function bindContext(root: string, credentials: CredentialInit = structuredClone(defaultCredentials)): BoundContext {
	const ctx = {
		root,
		credentials: createCredentials(credentials),
		descriptors: new Map(),
		pwd: root,
	} satisfies FSContext;

	return {
		...ctx,
		fs: {
			..._bindFunctions(fs, ctx),
			promises: _bindFunctions(fs.promises, ctx),
			xattr: _bindFunctions(fs.xattr, ctx),
		},
		path: _bindFunctions(path, ctx),
	};
}
