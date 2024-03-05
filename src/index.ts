/**
 * BrowserFS's main module. This is exposed in the browser via the BrowserFS global.
 */

import fs from './emulation/fs.js';
import { FileSystem } from './filesystem.js';
import { backends } from './backends/index.js';
import { ErrorCode, ApiError } from './ApiError.js';
import { Cred } from './cred.js';
import type { Backend } from './backends/backend.js';
import { type MountMapping, setCred } from './emulation/shared.js';

/**
 * Initializes BrowserFS with the given file systems.
 */
export function initialize(mounts: { [point: string]: FileSystem }, uid: number = 0, gid: number = 0) {
	setCred(new Cred(uid, gid, uid, gid, uid, gid));
	return fs.initialize(mounts);
}

/**
 * Specifies a file system backend type and its options.
 *
 * Individual options can recursively contain FileSystemConfiguration objects for
 * option values that require file systems.
 *
 * For example, to mirror Dropbox to Storage with AsyncMirror, use the following
 * object:
 *
 * ```javascript
 * var config = {
 *   fs: "AsyncMirror",
 *   options: {
 *     sync: {fs: "Storage"},
 *     async: {fs: "Dropbox", options: {client: anAuthenticatedDropboxSDKClient }}
 *   }
 * };
 * ```
 *
 * The option object for each file system corresponds to that file system's option object passed to its `Create()` method.
 */
export interface BackendConfiguration {
	backend: Backend;
	options?: object;
}

/**
 * Retrieve a file system with the given configuration.
 * @param config A FileSystemConfiguration object. See FileSystemConfiguration for details.
 */
async function getFileSystem({ backend, options = {} }: BackendConfiguration): Promise<FileSystem> {
	if (!backend) {
		throw new ApiError(ErrorCode.EPERM, 'Missing backend');
	}

	if (typeof options !== 'object' || options == null) {
		throw new ApiError(ErrorCode.EINVAL, 'Invalid options on configuration object.');
	}

	const props = Object.keys(options).filter(k => k != 'backend');

	for (const prop of props) {
		const opt = options[prop];
		if (opt === null || typeof opt !== 'object' || !('fs' in opt)) {
			continue;
		}

		const fs = await getFileSystem(opt);
		options[prop] = fs;
	}

	const fsc = backend;
	if (!fsc) {
		throw new ApiError(ErrorCode.EPERM, `File system ${backend} is not available in BrowserFS.`);
	} else {
		return fsc.create(options);
	}
}

/**
 * Defines a mapping of mount points to their configurations
 */
export interface ConfigMapping {
	[mountPoint: string]: FileSystem | BackendConfiguration | keyof typeof backends | Backend;
}

/**
 * A configuration for BrowserFS
 */
export type Configuration = FileSystem | BackendConfiguration | ConfigMapping;

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

		if ('isAvailable' in value) {
			value = { backend: value };
		}

		config[point] = await getFileSystem(value);
	}
	return initialize(config as MountMapping);
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
