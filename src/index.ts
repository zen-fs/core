/**
 * BrowserFS's main module. This is exposed in the browser via the BrowserFS global.
 */
import * as fs from './emulation/index.js';
import { FileSystem } from './filesystem.js';
import { backends } from './backends/index.js';
import { Cred } from './cred.js';
import { isBackend, type Backend, type BackendConfig, resolveBackendConfig } from './backends/backend.js';
import { type MountMapping, setCred } from './emulation/shared.js';

/**
 * Initializes BrowserFS with the given file systems.
 */
export function initialize(mounts: { [point: string]: FileSystem }, uid: number = 0, gid: number = 0) {
	setCred(new Cred(uid, gid, uid, gid, uid, gid));
	fs.initialize(mounts);
}

/**
 * Defines a mapping of mount points to their configurations
 */
export interface ConfigMapping {
	[mountPoint: string]: FileSystem | BackendConfig | keyof typeof backends | Backend;
}

/**
 * A configuration for BrowserFS
 */
export type Configuration = FileSystem | BackendConfig | ConfigMapping;

/**
 * Creates filesystems with the given configuration, and initializes BrowserFS with it.
 * See the Configuration type for more info on the configuration object.
 */
export async function configure(config: Configuration): Promise<void> {
	if ('backend' in config || config instanceof FileSystem) {
		// single FS
		config = <ConfigMapping>{ '/': config };
	}
	for (let [point, value] of Object.entries(config)) {
		if (typeof value == 'number') {
			//should never happen
			continue;
		}

		if (value instanceof FileSystem) {
			continue;
		}

		if (typeof value == 'string') {
			value = { backend: backends[value] };
		}

		if (isBackend(value)) {
			value = { backend: value };
		}

		config[point] = await resolveBackendConfig(value);
	}
	initialize(<MountMapping>config);
}

export * from './backends/index.js';
export * from './backends/AsyncStore.js';
export * from './backends/SyncStore.js';
export * from './ApiError.js';
export * from './cred.js';
export * from './FileIndex.js';
export * from './file.js';
export * from './filesystem.js';
export * from './inode.js';
export * from './mutex.js';
export * from './stats.js';
export * from './utils.js';
export { fs };
export default fs;
