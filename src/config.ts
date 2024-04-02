import type { Backend, BackendConfig } from './backends/backend.js';
import { isBackend, resolveBackendConfig } from './backends/backend.js';
import * as fs from './emulation/index.js';
import { setCred, type MountMapping } from './emulation/shared.js';
import { FileSystem } from './filesystem.js';

/**
 * Initializes ZenFS with the given file systems.
 */
export function initialize(mounts: { [point: string]: FileSystem }, uid: number = 0, gid: number = 0) {
	setCred({ uid, gid, suid: uid, sgid: gid, euid: uid, egid: gid });
	fs.initialize(mounts);
}

/**
 * Defines a mapping of mount points to their configurations
 */
export interface ConfigMapping {
	[mountPoint: string]: FileSystem | BackendConfig | Backend;
}

/**
 * A configuration for ZenFS
 */
export type Configuration = FileSystem | BackendConfig | ConfigMapping;

/**
 * Creates filesystems with the given configuration, and initializes ZenFS with it.
 * See the Configuration type for more info on the configuration object.
 */
export async function configure(config: Configuration): Promise<void> {
	if ('backend' in config || config instanceof FileSystem) {
		// single FS
		config = { '/': <BackendConfig | FileSystem>config };
	}
	for (let [point, value] of Object.entries(config)) {
		if (typeof value == 'number') {
			//should never happen
			continue;
		}

		if (value instanceof FileSystem) {
			continue;
		}

		if (isBackend(value)) {
			value = { backend: value };
		}

		config[point] = await resolveBackendConfig(value);
	}
	initialize(<MountMapping>config);
}
