// SPDX-License-Identifier: LGPL-3.0-or-later
// This needs to be in a separate file to avoid circular dependencies
import { withErrno } from 'kerium';
import { warn } from 'kerium/log';
import type { Bound } from 'utilium';
import type * as fs from '../node/index.js';
import type * as path from '../path.js';
import type { Handle } from '../vfs/file.js';
import type * as xattr from '../vfs/xattr.js';
import type { Credentials, CredentialsInit } from './credentials.js';
import { createCredentials } from './credentials.js';
import type { FileSystem } from './filesystem.js';

/**
 * Symbol used for context branding
 * @internal @hidden
 */
const kIsContext = Symbol('ZenFSContext');

/**
 * A context used for FS operations
 * @category Contexts
 */
export interface FSContext {
	/** Brand */
	readonly [kIsContext]: boolean;

	/** The unique ID of the context */
	readonly id: number;

	/**
	 * The absolute root path of the context.
	 * Note the parent's root is not considered
	 */
	root: string;

	/** The current working directory of the context */
	pwd: string;

	/** The credentials of the context, used for access checks */
	readonly credentials: Credentials;

	/**
	 * The file mode creation mask, as `umask(2)`: the permission bits set here are cleared from the mode of
	 * every file and directory this context creates. A child context starts with its parent's, as a forked
	 * process does. `0` (the default context's) masks nothing.
	 */
	umask: number;

	/** A map of open file descriptors to their handles */
	readonly descriptors: Map<number, Handle>;

	/** The parent context, if any. */
	readonly parent: FSContext | null;

	/** The child contexts */
	readonly children: FSContext[];

	/** The mount table for this context */
	readonly mounts: Map<string, FileSystem>;
}

export function isContext(obj: unknown): obj is FSContext {
	return typeof obj === 'object' && obj !== null && kIsContext in obj;
}

export function assertContext(ctx: unknown): asserts ctx is FSContext {
	if (!isContext(ctx)) throw warn(withErrno('EINVAL', 'Invalid context provided'));
}

/**
 * maybe an FS context
 */
export type V_Context = unknown;

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * @category Contexts
 */
export interface BoundContext extends FSContext {
	fs: Bound<typeof fs, FSContext> & { promises: Bound<typeof fs.promises, FSContext>; xattr: Bound<typeof xattr, FSContext> };

	/** Path functions, bound to the context */
	path: Bound<typeof path, FSContext>;

	/** Creates a new child context with this context as the parent */
	bind(init: ContextInit): BoundContext;

	/** The parent context, if any. */
	parent: FSContext;
}

/**
 * @category Contexts
 */
export interface ContextInit {
	root?: string;
	pwd?: string;
	credentials?: CredentialsInit;
	/** The file mode creation mask. Defaults to the parent's. */
	umask?: number;
	mounts?: Record<string, FileSystem>;
}

/**
 * The default/global context.
 * @internal @hidden
 * @category Contexts
 */
export const defaultContext: FSContext = {
	[kIsContext]: true,
	id: 1,
	root: '/',
	pwd: '/',
	credentials: createCredentials({ uid: 0, gid: 0 }),
	umask: 0,
	descriptors: new Map(),
	parent: null,
	children: [],
	mounts: new Map(),
};

export function contextOf($: unknown): FSContext {
	return isContext($) ? $ : defaultContext;
}

/**
 * The mode a file or directory is created with: `mode` without the permission bits the context's `umask` clears.
 * Bits above the permission bits (the file type, setuid, setgid, sticky) are not affected.
 * @internal
 */
export function applyUmask($: unknown, mode: number): number {
	return mode & ~(contextOf($).umask & 0o777);
}

// 1 is reserved for the global/default context
let _nextId = 2;

/**
 * Create a blank FS Context
 * @internal
 * @category Contexts
 * @todo Make sure parent root can't be escaped
 *
 * This exists so that `kIsContext` is not exported and to make sure the context is "secure".
 */
export function createChildContext(parent: FSContext, init: ContextInit = {}): FSContext & { parent: FSContext } {
	assertContext(parent);

	const { root = parent.root, pwd = parent.pwd, credentials = structuredClone(parent.credentials), umask = parent.umask, mounts } = init;

	const ctx: FSContext & { parent: FSContext } = {
		[kIsContext]: true,
		id: _nextId++,
		root,
		pwd,
		credentials: createCredentials(credentials),
		umask: umask & 0o777,
		descriptors: new Map(),
		parent: parent,
		children: [],
		mounts: mounts ? new Map(Object.entries(mounts)) : parent.mounts,
	};

	Object.defineProperties(ctx, {
		id: { configurable: false, writable: false },
		credentials: { configurable: false, writable: false },
		descriptors: { configurable: false, writable: false },
		parent: { configurable: false, writable: false },
		children: { configurable: false, writable: false },
	});

	return ctx;
}
