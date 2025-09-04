import { withErrno } from 'kerium';
import type * as fs from 'node:fs';
import { resolve } from './path.js';
import { type V_Context } from './internal/contexts.js';
import "./internal/init_context.js";

// NOTE: without utils_base.ts, there is a circular dependency with path.ts
export * from './utils_base.js';

/**
 * Normalizes a path
 * @internal
 */
export function normalizePath(this: V_Context, p: fs.PathLike, noResolve: boolean = false): string {
	if (p instanceof URL) {
		if (p.protocol != 'file:') throw withErrno('EINVAL', 'URLs must use the file: protocol');
		p = p.pathname;
	}
	p = p.toString();
	if (p.startsWith('file://')) p = p.slice('file://'.length);
	if (p.includes('\x00')) throw withErrno('EINVAL', 'Path can not contain null character');
	if (p.length == 0) throw withErrno('EINVAL', 'Path can not be empty');
	p = p.replaceAll(/[/\\]+/g, '/');

	// Note: PWD is not resolved here, it is resolved later.
	return noResolve ? p : resolve.call(this, p);
}