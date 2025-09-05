import type * as path from '../path.js';
import type { SyncHandle } from '../vfs/file.js';
import type * as fs from '../vfs/index.js';
import type { Credentials, CredentialsInit } from './credentials.js';
import { createCredentials } from './credentials.js';
import { FileSystem } from './filesystem.js';
import { InMemory } from '../backends/memory.js';
import { type FSContext, type V_Context, allContexts, rootContexts, _initDefaultContext } from './contexts.js';

// NOTE: context.ts is a separate file to prevent circular dependencies when 
// things like path.ts need to call getContext()
// (e.g. context.ts->memory.ts->fs.ts->file_index.ts->path.ts->context.ts)

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

_initDefaultContext(_createUnboundRootContext({}));