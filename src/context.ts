// SPDX-License-Identifier: LGPL-3.0-or-later
import { bindFunctions } from 'utilium';
import type { BoundContext, ContextInit, FSContext, V_Context } from './internal/contexts.js';
import { defaultContext } from './internal/contexts.js';
import { createCredentials } from './internal/credentials.js';
import * as path from './path.js';
import * as fs from './node/index.js';

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
 */
export function bindContext(
	this: void | null | FSContext,
	{ root = this?.root || '/', pwd = this?.pwd || '/', credentials = structuredClone(defaultContext.credentials) }: ContextInit = {}
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
