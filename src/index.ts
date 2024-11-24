export * from './error.js';
export * from './backends/port/fs.js';
export * from './backends/fetch.js';
export * from './backends/memory.js';
export * from './backends/file_index.js';
export * from './backends/overlay.js';
export * from './backends/store/fs.js';
export * from './backends/store/simple.js';
export * from './backends/store/store.js';
export * from './backends/backend.js';
export * from './config.js';
export * from './context.js';
export * from './credentials.js';
export * from './devices.js';
export { default as devices } from './devices.js';
export * from './file.js';
export * from './filesystem.js';
export * from './inode.js';
export * from './mixins/index.js';
export * from './stats.js';
export * from './utils.js';

export * from './emulation/index.js';
import * as fs from './emulation/index.js';
export { fs };
export default fs;

declare global {
	/**
	 * Global FS emulation. Do not use unless absolutely needed.
	 * @hidden
	 */
	// eslint-disable-next-line no-var
	var __zenfs__: typeof fs;
}
globalThis.__zenfs__ = fs;
