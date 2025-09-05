// SPDX-License-Identifier: LGPL-3.0-or-later
import type { SyncHandle } from '../vfs/file.js';
import type { Credentials, CredentialsInit } from './credentials.js';
import type { FileSystem } from './filesystem.js';
import { createCredentials } from './credentials.js';

// NOTE1: this file is separate from init_context.ts because of circular dependencies
// for example, previously:
//     context.ts->memory.ts->fs.ts->file_index.ts->path.ts->context.ts
//     context.ts->memory.ts->fs.ts->file_index.ts->inode.ts->context.ts
//     context.ts->memory.ts->fs.ts->utils.ts->inode.ts->context.ts
// NOTE2: import { SyncHandle } is still a circular dependency but 
// because it is only a type import, typescript is able to figure it out

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

let defaultContext : V_Context = null;

/**
 * Only internal/context.ts should ever call this function
 * @internal @hidden
 * @category Contexts
 */
export function _initDefaultContext(context : FSContext) {
    if (defaultContext != null) {
        throw new Error("This shouldn't be possible, but _initDefaultContext() was called after the defaultContext was already initialized. Only internal/context.ts should ever call this function");
    }
    defaultContext = context;
}

export function getContext($: V_Context): FSContext {
    if (defaultContext == null) {
        throw new Error("This shouldn't be possible, but somehow getContext was called before the default context was set");
    }
    if (!$) {
        return defaultContext as FSContext;
    }
    if (($ as any)[Symbol.toStringTag] == 'Module') {
        return defaultContext;
    }
    return $;
}