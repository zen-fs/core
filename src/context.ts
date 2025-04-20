import { bindFunctions } from 'utilium';
import type { BoundContext, ContextInit, FSContext, V_Context } from './internal/contexts.js';
import { defaultContext } from './internal/contexts.js';
import { createCredentials } from './internal/credentials.js';
import * as path from './path.js';
import * as fs from './vfs/index.js';

export type { BoundContext, ContextInit, FSContext, V_Context };

// 0 is reserved for the global/default context
let _nextId = 1;

/**
 * A map of all contexts.
 * @internal
 * @category Contexts
 */
export const boundContexts = new Map<number, BoundContext>();

/**
 * Allows you to restrict operations to a specific root path and set of credentials.
 * Note that the default credentials of a bound context are copied from the global credentials.
 * @category Contexts
 * @example
 * ```ts
 * import { bindContext, fs as root } from '@zenfs/core'; // or your existing
 * import assert from 'node:assert';
 * 
 * for(const i of [1, 2, 3]) root.mkdirSync('/' + i);
 * root.mkdirSync('/root_1');
 * 
 * const { fs: fs1 } = bindContext({ root: '/1' });
 * const { fs: fs2 } = bindContext({ root: '/2' });
 * const { fs: fs3 } = bindContext({ root: '/3' });
 * const ctx = bindContext({ root: '/root_1' }); // note the PWD is relative to the context's root
 * 
 * ctx.fs.mkdirSync('/sub');
 * const { fs: sub } = ctx.bind({ root: '/sub' });
 * sub.writeFileSync('double-nested.txt', 'whoa');
 * 
 * assert(root.existsSync('/root_1/sub'));
 * 
 * fs1.writeFileSync('/example.txt', 'fs1');
 * fs2.writeFileSync('/example.txt', 'fs2');
 * fs3.writeFileSync('/example.txt', 'fs3');
 * ctx.fs.writeFileSync('/example.txt', 'fs4');
 * 
 * assert(!root.existsSync('/example.txt'));
 * 
 * assert.equal(root.readFileSync('/root_1/example.txt', 'utf8'), 'fs4');
 * 
 * assert.deepEqual(ctx.fs.readdirSync('/../../../..'), root.readdirSync('/root_1'));
 * ```
 */
export function bindContext(
	this: void | null | FSContext,
	{
        root = this?.root || '/',
        pwd = this?.pwd || '/',
        credentials = structuredClone(defaultContext.credentials),
        mounts = this?.mounts || defaultContext.mounts,
    }: ContextInit = {}
): BoundContext {
	const parent = this ?? defaultContext;

	const ctx: FSContext & { parent: FSContext } = {
		id: _nextId++,
		root,
		pwd,
		credentials: createCredentials(credentials),
		descriptors: new Map(),
		parent,
		children: [],
	};
    
    if (mounts) {
        ctx.mounts = mounts;
    }
	const bound = {
		...ctx,
		fs: {
			...bindFunctions(fs, ctx),
			promises: bindFunctions(fs.promises, ctx),
			xattr: bindFunctions(fs.xattr, ctx),
		},
		path: bindFunctions(path, ctx),
		bind: (init: ContextInit) => {
			const child = bindContext.call(ctx, init);
			ctx.children.push(child);
			return child;
		},
	};

	boundContexts.set(ctx.id, bound);

	return bound;
}
