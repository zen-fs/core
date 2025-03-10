/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CredentialsInit, Credentials } from './internal/credentials.js';
import { createCredentials, credentials as defaultCredentials } from './internal/credentials.js';
import * as path from './path.js';
import type { SyncHandle } from './vfs/file.js';
import * as fs from './vfs/index.js';

/**
 * @category Contexts
 */
type Bound<T> = T & {
	[k in keyof T]: T[k] extends (...args: any[]) => any ? (this: FSContext, ...args: Parameters<T[k]>) => ReturnType<T[k]> : T[k];
};

/**
 * Binds a this value for all of the functions in an object (not recursive)
 * @category Contexts
 * @internal
 */
function _bindFunctions<T extends Record<string, unknown>>(fns: T, thisValue: FSContext) {
	return Object.fromEntries(Object.entries(fns).map(([k, v]) => [k, typeof v == 'function' ? v.bind(thisValue) : v])) as Bound<T>;
}

/**
 * A context used for FS operations
 * @category Contexts
 */
export interface FSContext {
	/** The unique ID of the context */
	readonly id: number;

	/**
	 * The absolute root path of the context
	 *
	 * Note the parent's root is not considered
	 */
	root: string;

	/** The current working directory of the context */
	pwd: string;

	/** The credentials of the context, used for access checks */
	readonly credentials: Credentials;

	/** A map of open file descriptors to their handles */
	descriptors: Map<number, SyncHandle>;

	/** The parent context, if any. */
	parent: V_Context;

	/** The child contexts */
	children: FSContext[];
}

/**
 * maybe an FS context
 */
export type V_Context = void | null | (Partial<FSContext> & object);

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * @category Contexts
 */
export interface BoundContext extends FSContext {
	fs: Bound<typeof fs> & { promises: Bound<typeof fs.promises>; xattr: Bound<typeof fs.xattr> };

	/** Path functions, bound to the context */
	path: Bound<typeof path>;

	/** Creates a new child context with this context as the parent */
	bind(init: ContextInit): BoundContext;
}

let _nextId = 0;

/**
 * @category Contexts
 */
export interface ContextInit {
	root?: string;
	pwd?: string;
	credentials?: CredentialsInit;
}

/**
 * @internal
 * @category Contexts
 */
const _contexts = new Map<number, BoundContext>();

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * Note that the default credentials of a bound context are copied from the global credentials.
 * @category Contexts
 */
export function bindContext(
	this: V_Context,
	{ root = this?.root || '/', pwd = this?.pwd || '/', credentials = structuredClone(defaultCredentials) }: ContextInit = {}
): BoundContext {
	const ctx: FSContext = {
		id: _nextId++,
		root,
		pwd,
		credentials: createCredentials(credentials),
		descriptors: new Map(),
		parent: this ?? undefined,
		children: [],
	};

	const bound = {
		...ctx,
		fs: {
			..._bindFunctions(fs, ctx),
			promises: _bindFunctions(fs.promises, ctx),
			xattr: _bindFunctions(fs.xattr, ctx),
		},
		path: _bindFunctions(path, ctx),
		bind: (init: ContextInit) => {
			const child = bindContext.call(ctx, init);
			ctx.children.push(child);
			return child;
		},
	};

	_contexts.set(ctx.id, bound);

	return bound;
}
