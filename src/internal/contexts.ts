// This needs to be in a separate file to avoid circular dependencies
import type { Bound } from 'utilium';
import type * as path from '../path.js';
import type { SyncHandle } from '../vfs/file.js';
import type * as fs from '../vfs/index.js';
import type { Credentials, CredentialsInit } from './credentials.js';
import { createCredentials } from './credentials.js';
import { FileSystem } from '../internal/filesystem.js';

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
    
    /** A map of mount points to file systems */
    mounts?: Map<string, FileSystem>;
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
	fs: Bound<typeof fs, FSContext> & { promises: Bound<typeof fs.promises, FSContext>; xattr: Bound<typeof fs.xattr, FSContext> };

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
    mounts?: Map<string, FileSystem>;
}

/**
 * The default/global context.
 * @internal @hidden
 * @category Contexts
 */
export const defaultContext: FSContext = {
	id: 0,
	root: '/',
	pwd: '/',
	credentials: createCredentials({ uid: 0, gid: 0 }),
	descriptors: new Map(),
	parent: null,
	children: [],
};
