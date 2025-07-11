export * from './backends/index.js';
export * from './config.js';
export * from './context.js';
export * from './internal/index.js';
export * from './mixins/index.js';
export * from './vfs/stats.js';
export * from './utils.js';
export * from './vfs/index.js';
import { context } from './context.js';
const mounts = context.mounts;
export { mounts };
export { fs };
import * as fs from './vfs/index.js';
export default fs;
import $pkg from '../package.json' with { type: 'json' };

declare const globalThis: {
	/**
	 * Global VFS. Do not use unless absolutely needed.
	 * @hidden
	 */
	__zenfs__: typeof fs;
};

globalThis.__zenfs__ = Object.assign(Object.create(fs), { _version: $pkg.version });
