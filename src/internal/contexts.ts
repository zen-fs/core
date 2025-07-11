// This needs to be in a separate file to avoid circular dependencies
import type * as path from '../path.js';
import type { SyncHandle } from '../vfs/file.js';
import type * as fs from '../vfs/index.js';
import type { Credentials, CredentialsInit } from './credentials.js';
import { createCredentials } from './credentials.js';
import { FileSystem } from '../internal/filesystem.js';
import { InMemory } from '../backends/memory.js';

/**
 * All contexts
 * @internal
 * @category Contexts
 */
export const allContexts: Record<string, FSContext> = {};

/**
 * A context used for FS operations
 * @category Contexts
 */
export interface FSContext {
	/** The unique ID of the context */
	readonly id: string;

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

	/** The child contexts */
	children: FSContext[];

	/** A map of mount points to file systems */
	mounts: Map<string, FileSystem>;

	/** The parent context, if any. */
	parent: null | FSContext;
}

/**
 * maybe FSContext or StrongFSContext
 */
export type V_Context = void | null | FSContext;

/**
 * A map of all top level contexts (no parents)
 * @internal
 * @category Contexts
 */
export const rootContexts: FSContext[] = [];

/**
 * safe creation of an additional root context
 * @internal
 * @category Contexts
 */
export function _createUnboundRootContext(options: Record<string, unknown>): FSContext {
	const id = `${rootContexts.length}`;
    const rootMemory = InMemory.create({ label: 'root' })
    const ctx = {
        id,
        root: options.root || '/',
        pwd: options.pwd || '/',
        credentials: createCredentials({ uid: 0, gid: 0, ...options.credentials||{} }),
        descriptors: new Map() as Map<number, SyncHandle>,
        parent: null,
        children: [] as FSContext[],
        mounts: options.mounts || new Map([ ['/', rootMemory] ]) as Map<string, FileSystem>,
    } as FSContext;
    rootMemory._mountPoint = "/";
    if (allContexts[id]) throw new Error('Do no construct FSContexts directly. Context with id ' + id + ' already exists.');
    allContexts[id] = ctx;
	rootContexts.push(ctx);
	return ctx;
}

/**
 * safe creation of a child context
 * @internal
 * @category Contexts
 */
export function _createUnboundChildContext(parent: FSContext, options: Record<string, unknown>): FSContext {
	const id = `${parent.id}-${parent.children.length}`;
	const ctx = {
        id,
        root: (options.root || parent.root) as string,
        pwd: (options.pwd || parent.pwd) as string,
        credentials: createCredentials({ gid: 0, uid: 0, ...options.credentials||structuredClone(parent.credentials) }),
        descriptors: new Map() as Map<number, SyncHandle>,
        parent,
        children: [] as FSContext[],
        mounts: (options.mounts || parent.mounts) as Map<string, FileSystem>,
    } as FSContext;
	ctx.parent = parent;
	parent.children.push(ctx);
	return ctx;
}

/**
 * The default/global context.
 * @internal @hidden
 * @category Contexts
 */
export const defaultContext = _createUnboundRootContext({});

export function getContext($: V_Context): FSContext {
    if (!$) {
        return defaultContext;
    }
    if (($ as any)[Symbol.toStringTag] == 'Module') {
        return defaultContext;
    }
    return $;
}