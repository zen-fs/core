export * from './backends/index.js';
export * from './config.js';
export * from './context.js';
export * from './internal/credentials.js';
export * from './internal/devices.js';
export * from './internal/error.js';
export * from './internal/file.js';
export * from './internal/filesystem.js';
export * as log from './internal/log.js';
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
