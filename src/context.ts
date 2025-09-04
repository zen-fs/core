import type { Bound } from 'utilium';
import type { Credentials, CredentialsInit } from './internal/credentials.js';
import type { FSContext, V_Context } from './internal/contexts.js';

import { bindFunctions } from 'utilium';
import { getContext, allContexts, rootContexts } from './internal/contexts.js';
import { _createUnboundRootContext, _createUnboundChildContext } from './internal/init_context.js';
import { createCredentials } from './internal/credentials.js';
import * as unboundPath from './path.js';
import * as unboundFs from './vfs/index.js';
import { InMemory } from './backends/memory.js';
import { FileSystem } from './internal/filesystem.js';

export type { V_Context }
// summary:
//   - our goal is for all contexts to be bound contexts
//     (the user should never need to know bound/unbound exists)
//     e.g. the context object should:
//       - have a .fs property
//       - have a .path property
//       - have a .createChildContext() method
//   - PROBLEM: those things^ create a circular dependency
//     (defaultContext imports fs)
//     (fs imports defaultContext)
//   - SOLUTION: the weak context object
//       - we create weak context object (FSContext) that fs/path can import
//       - customize that weak context object as needed
//       - then update (mutate) that object to meet the
//         definition of the BoundContext strong context interface

/**
 * @category Contexts
 */
export interface RestrictedContextOptions {
	root?: string;
	pwd?: string;
	credentials?: CredentialsInit;
	mounts?: Map<string, FileSystem>;
}

/**
 * @category Contexts
 */
export interface BoundContext extends FSContext {
	fs: Bound<typeof unboundFs, FSContext> & {
		promises: Bound<typeof unboundFs.promises, FSContext>;
		xattr: Bound<typeof unboundFs.xattr, FSContext>;
	};

	/** Path functions, bound to the context */
	path: Bound<typeof unboundPath, FSContext>;

	/**
	 * Allows you to restrict operations to a specific root path and set of credentials.
	 * Note that the default credentials of a bound context are copied from the parent
	 * @category Contexts
	 * @example
	 * ```ts
	 * import { context as defaultContext } from '@zenfs/core';
	 * import assert from 'node:assert';
	 *
	 * for(const i of [1, 2, 3]) defaultContext.fs.mkdirSync('/' + i);
	 *
	 * const childContext1 = defaultContext.createChildContext({ root: '/1' });
	 * const childContext2 = defaultContext.createChildContext({ root: '/2' });
	 * const childContext3 = defaultContext.createChildContext({ root: '/3' });
	 * childContext1.fs.writeFileSync('/example.txt', 'fs1');
	 * childContext2.fs.writeFileSync('/example.txt', 'fs2');
	 * childContext3.fs.writeFileSync('/example.txt', 'fs3');
	 *
	 * assert(!defaultContext.fs.existsSync('/example.txt'));
	 * assert(defaultContext.fs.existsSync('/1/example.txt'));
	 * assert(defaultContext.fs.existsSync('/2/example.txt'));
	 * assert(defaultContext.fs.existsSync('/3/example.txt'));
	 *
	 * // cannot escape their own root
	 * assert(!childContext1.fs.existsSync('../1/example.txt'));
	 * assert(!childContext1.fs.existsSync('../2/example.txt'));
	 * assert(!childContext1.fs.existsSync('../3/example.txt'));
	 *
	 * // double nested contexts
	 * childContext3.mkdirSync('/sub');
	 * const grandchildContext = childContext3.createChildContext({ root: '/sub' });
	 * grandchildContext.writeFileSync('double-nested.txt', 'whoa');
	 * assert(defaultContext.fs.existsSync('/3/sub/double-nested.txt'));
	 * isolatedContext1.fs.writeFileSync('/example.txt', 'fs4');
	 * ```
	 */
	createChildContext(init: RestrictedContextOptions): BoundContext;
}

/**
 * Creates a strong context with no parents
 * Useful for creating completely isolated in-memory environments
 * @category Contexts
 * @example
 * ```ts
 * import { context as defaultContext, fs, createIsolatedContext } from '@zenfs/core';
 * import assert from 'node:assert';
 *
 * const isolatedContext1 = createIsolatedContext({ root: '/' });
 * const isolatedContext2 = createIsolatedContext({ root: '/' });
 *
 * isolatedContext1.fs.writeFileSync('/example.txt', 'fs2');
 * isolatedContext2.fs.writeFileSync('/example.txt', 'fs3');
 *
 * // no effect on other contexts
 * assert(!defaultContext.fs.fs.existsSync('/example.txt'));
 * ```
 */
export function createIsolatedContext(options: RestrictedContextOptions = {}): BoundContext {
	const rootContext = _createUnboundRootContext({
        root: options.root || '/',
        pwd: options.pwd || '/',
        mounts: options.mounts || new Map([['/', InMemory]]),
        credentials: createCredentials({ uid: 0, gid: 0, ...options.credentials }),
    });
	upgradeToBoundContext(rootContext);
	return rootContext as BoundContext;
}

/**
 * Creates a new child context with this context as the parent
 * @category Contexts
 * @internal
 */
function _createStrongChildContext(this: BoundContext, init: RestrictedContextOptions = {}): BoundContext {
	const childContext = _createUnboundChildContext(this, init as Record<string, unknown>);
	upgradeToBoundContext(childContext);
	return childContext as BoundContext;
}

/**
 * Strengthen a weak context to a strong context
 * @internal
 */
function upgradeToBoundContext(context: FSContext) {
	Object.assign(context, {
		fs: {
			...bindFunctions(unboundFs, context),
			promises: bindFunctions(unboundFs.promises, context),
			xattr: bindFunctions(unboundFs.xattr, context),
		},
		path: bindFunctions(unboundPath, context),
		createChildContext: _createStrongChildContext.bind(context as BoundContext),
	});
}

// convert the default context from merely FSContext to BoundContext
const defaultContextLink = getContext(null);
upgradeToBoundContext(defaultContextLink);

export { defaultContextLink as context, rootContexts };
