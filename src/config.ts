import { ErrnoError, Errno } from './error.js';
import type { Backend, BackendConfiguration } from './backends/backend.js';
import { checkOptions, isBackend, isBackendConfig } from './backends/backend.js';
import * as fs from './emulation/index.js';
import { setCred, type MountObject } from './emulation/shared.js';
import { FileSystem } from './filesystem.js';
import type { AbsolutePath } from './emulation/path.js';

/**
 * Configuration for a specific mount point
 */
export type MountConfiguration<FS extends FileSystem = FileSystem, TOptions extends object = object> = FS | BackendConfiguration<Backend<FS, TOptions>> | Backend<FS, TOptions>;

function isMountConfig(arg: unknown): arg is MountConfiguration {
	return isBackendConfig(arg) || isBackend(arg) || arg instanceof FileSystem;
}

/**
 * Retrieve a file system with the given configuration.
 * @param config A BackendConfig object.
 */
export async function resolveMountConfig<FS extends FileSystem, TOptions extends object = object>(config: MountConfiguration<FS, TOptions>, _depth = 0): Promise<FS> {
	if (typeof config !== 'object' || config == null) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid options on mount configuration');
	}

	if (!isMountConfig(config)) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid mount configuration');
	}

	if (config instanceof FileSystem) {
		return config;
	}

	if (isBackend(config)) {
		config = { backend: config } as BackendConfiguration<Backend<FS, TOptions>>;
	}

	for (const [key, value] of Object.entries(config)) {
		if (key == 'backend') {
			continue;
		}

		if (!isMountConfig(value)) {
			continue;
		}

		if (_depth > 10) {
			throw new ErrnoError(Errno.EINVAL, 'Invalid configuration, too deep and possibly infinite');
		}

		(<Record<string, FileSystem>>config)[key] = await resolveMountConfig(value, ++_depth);
	}

	const { backend } = config;

	if (!(await backend.isAvailable())) {
		throw new ErrnoError(Errno.EPERM, 'Backend not available: ' + backend);
	}
	checkOptions(backend, config);
	const mount = await backend.create(config);
	await mount.ready();
	return mount;
}

/**
 * Configuration
 */
export interface Configuration {
	mounts: Record<AbsolutePath, MountConfiguration>;
	uid?: number;
	gid?: number;
}

/**
 * Creates filesystems with the given configuration, and initializes ZenFS with it.
 * @see Configuration for more info on the configuration object.
 */
export async function configure<T extends MountConfiguration | Configuration>(config: T | Configuration): Promise<void> {
	const uid = 'uid' in config ? config.uid || 0 : 0;
	const gid = 'gid' in config ? config.gid || 0 : 0;

	if (isMountConfig(config)) {
		// single FS
		config = { mounts: { '/': config } };
	}

	for (const [point, value] of Object.entries(config.mounts) as [AbsolutePath, MountConfiguration][]) {
		if (!point.startsWith('/')) {
			throw new ErrnoError(Errno.EINVAL, 'Mount points must have absolute paths');
		}
		config.mounts[point] = await resolveMountConfig(value);
	}

	fs.mountObject(config.mounts as MountObject);
	setCred({ uid, gid, suid: uid, sgid: gid, euid: uid, egid: gid });
}
