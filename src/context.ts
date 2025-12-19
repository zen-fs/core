// SPDX-License-Identifier: LGPL-3.0-or-later
import { UV } from 'kerium';
import { bindFunctions } from 'utilium';
import type { BoundContext, ContextInit, FSContext, V_Context } from './internal/contexts.js';
import { contextOf, createChildContext } from './internal/contexts.js';
import * as fs from './node/index.js';
import * as path from './path.js';
import * as xattr from './vfs/xattr.js';

export type { BoundContext, ContextInit, FSContext, V_Context };

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
export function bindContext(this: V_Context, init: ContextInit = {}): BoundContext {
	const $ = contextOf(this);

	if (!fs.statSync.call<typeof this, [string], fs.Stats>(this, $.root).isDirectory()) throw UV('ENOTDIR', { syscall: 'chroot', path: $.root });

	const ctx = createChildContext($, init);

	const bound = Object.assign(ctx, {
		fs: {
			...bindFunctions(fs, ctx),
			promises: bindFunctions(fs.promises, ctx),
			xattr: bindFunctions(xattr, ctx),
		},
		path: bindFunctions(path, ctx),
		bind: (init: ContextInit) => {
			const child = bindContext.call(ctx, init);
			ctx.children.push(child);
			return child;
		},
	}) satisfies BoundContext;

	boundContexts.set(ctx.id, bound);

	return bound;
}
