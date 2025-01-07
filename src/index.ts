export * from './backends/index.js';
export * from './config.js';
export * from './context.js';
export * from './credentials.js';
export * from './devices.js';
export * from './error.js';
export * from './file.js';
export * from './filesystem.js';
export * from './mixins/index.js';
export * from './stats.js';
export * from './utils.js';
export * from './vfs/index.js';
export { fs };
import * as fs from './vfs/index.js';
export default fs;

declare global {
	/**
	 * Global VFS. Do not use unless absolutely needed.
	 * @hidden
	 */
	// eslint-disable-next-line no-var
	var __zenfs__: typeof fs;
}
globalThis.__zenfs__ = fs;
