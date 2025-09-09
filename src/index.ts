// SPDX-License-Identifier: LGPL-3.0-or-later
export * from './backends/index.js';
export * from './config.js';
export * from './context.js';
export * from './internal/index.js';
export * from './mixins/index.js';
export * from './utils.js';
export { mounts } from './vfs/shared.js';
export { fs };
export * from './node/index.js';
import * as fs from './node/compat.js';
export default fs;
export * from './vfs/index.js';
import $pkg from '../package.json' with { type: 'json' };

declare const globalThis: {
	/**
	 * Global VFS. Do not use unless absolutely needed.
	 * @hidden
	 */
	__zenfs__: typeof fs;
};

globalThis.__zenfs__ = Object.assign(Object.create(fs), { _version: $pkg.version });
