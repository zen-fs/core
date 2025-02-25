export * from './backends/index.js';
export * from './config.js';
export * from './context.js';
export * from './internal/index.js';
export * from './mixins/index.js';
export * from './vfs/stats.js';
export * from './utils.js';
export { mounts } from './vfs/shared.js';
export * from './vfs/index.js';
export { fs };
import * as fs from './vfs/index.js';
export default fs;

declare const globalThis: {
	/**
	 * Global VFS. Do not use unless absolutely needed.
	 * @hidden
	 */
	__zenfs__: typeof fs;
};

globalThis.__zenfs__ = fs;
