// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Backend, BackendConfiguration, FilesystemOf, SharedConfig } from './backends/backend.js';
import type { Device, DeviceDriver } from './internal/devices.js';

import { log, withErrno } from 'kerium';
import { checkOptions, isBackend, isBackendConfig } from './backends/backend.js';
import { defaultContext } from './internal/contexts.js';
import { createCredentials } from './internal/credentials.js';
import { DeviceFS } from './internal/devices.js';
import { FileSystem } from './internal/filesystem.js';
import { exists, mkdir, stat } from './node/promises.js';
import { _setAccessChecks } from './vfs/config.js';
import { mount, mounts, umount } from './vfs/shared.js';

/**
 * Update the configuration of a file system.
 * @category Backends and Configuration
 */
export function configureFileSystem(fs: FileSystem, config: SharedConfig): void {
	if (config.disableAsyncCache) fs.attributes.set('no_async_preload');
	if (config.caseFold) fs.attributes.set('case_fold', config.caseFold);
}

/**
 * Configuration for a specific mount point
 * @category Backends and Configuration
 */
export type MountConfiguration<T extends Backend> = FilesystemOf<T> | BackendConfiguration<T> | T;

function isMountConfig<T extends Backend>(arg: unknown): arg is MountConfiguration<T> {
	return isBackendConfig(arg) || isBackend(arg) || arg instanceof FileSystem;
}

/**
 * Retrieve a file system with `configuration`.
 * @category Backends and Configuration
 * @see MountConfiguration
 */
export async function resolveMountConfig<T extends Backend>(configuration: MountConfiguration<T>, _depth = 0): Promise<FilesystemOf<T>> {
	if (typeof configuration !== 'object' || configuration == null) {
		throw log.err(withErrno('EINVAL', 'Invalid options on mount configuration'));
	}

	if (!isMountConfig(configuration)) {
		throw log.err(withErrno('EINVAL', 'Invalid mount configuration'));
	}

	if (configuration instanceof FileSystem) {
		await configuration.ready();
		return configuration;
	}

	if (isBackend(configuration)) {
		configuration = { backend: configuration } as BackendConfiguration<T>;
	}

	for (const [key, value] of Object.entries(configuration)) {
		if (key == 'backend') continue;
		if (!isMountConfig(value)) continue;

		log.info('Resolving nested mount configuration: ' + key);

		if (_depth > 10) {
			throw log.err(withErrno('EINVAL', 'Invalid configuration, too deep and possibly infinite'));
		}

		(configuration as Record<string, FileSystem>)[key] = await resolveMountConfig(value, ++_depth);
	}

	const { backend } = configuration;

	if (typeof backend.isAvailable == 'function' && !(await backend.isAvailable(configuration))) {
		throw log.err(withErrno('EPERM', 'Backend not available: ' + backend.name));
	}

	checkOptions(backend, configuration);
	const mount = (await backend.create(configuration)) as FilesystemOf<T>;
	configureFileSystem(mount, configuration);
	await mount.ready();
	return mount;
}

/**
 * An object mapping mount points to backends
 * @category Backends and Configuration
 */
export interface ConfigMounts {
	[K: string]: Backend;
}

/**
 * Configuration
 * @category Backends and Configuration
 */
export interface Configuration<T extends ConfigMounts> extends SharedConfig {
	/**
	 * An object mapping mount points to mount configuration
	 */
	mounts: { [K in keyof T]: MountConfiguration<T[K]> };

	/**
	 * The uid to use
	 * @default 0
	 */
	uid: number;

	/**
	 * The gid to use
	 * @default 0
	 */
	gid: number;

	/**
	 * Whether to automatically add normal Linux devices
	 * @default false
	 */
	addDevices: boolean;

	/**
	 * Whether to automatically create some directories (e.g. /tmp)
	 * @default false
	 */
	defaultDirectories: boolean;

	/**
	 * If true, disables *all* permissions checking.
	 *
	 * This can increase performance.
	 * @default false
	 */
	disableAccessChecks: boolean;

	/**
	 * If true, files will only sync to the file system when closed.
	 * This overrides `disableUpdateOnRead`
	 *
	 * This can increase performance.
	 * @experimental
	 * @default false
	 */
	onlySyncOnClose: boolean;

	/**
	 * Configurations options for the log.
	 */
	log: log.Configuration;
}

/**
 * Configures ZenFS with single mount point /
 * @category Backends and Configuration
 */
export async function configureSingle<T extends Backend>(configuration: MountConfiguration<T>): Promise<void> {
	if (!isMountConfig(configuration)) {
		throw new TypeError('Invalid single mount point configuration');
	}

	const resolved = await resolveMountConfig(configuration);
	umount('/');
	mount('/', resolved);
}

/**
 * Like `fs.mount`, but it also creates missing directories.
 * @privateRemarks
 * This is implemented as a separate function to avoid a circular dependency between vfs/shared.ts and other vfs layer files.
 * @internal
 */
async function mountWithMkdir(path: string, fs: FileSystem): Promise<void> {
	if (path == '/') {
		mount(path, fs);
		return;
	}

	const stats = await stat(path).catch(() => null);
	if (!stats) {
		await mkdir(path, { recursive: true });
	} else if (!stats.isDirectory()) {
		throw withErrno('ENOTDIR', 'Missing directory at mount point: ' + path);
	}
	mount(path, fs);
}

/**
 * @category Backends and Configuration
 */
export function addDevice(driver: DeviceDriver, options?: object): Device {
	const devfs = mounts.get('/dev');
	if (!(devfs instanceof DeviceFS)) throw log.crit(withErrno('ENOTSUP', '/dev does not exist or is not a device file system'));
	return devfs._createDevice(driver, options);
}

const _defaultDirectories = ['/tmp', '/var', '/etc'];

/**
 * Configures ZenFS with `configuration`
 * @category Backends and Configuration
 * @see Configuration
 */
export async function configure<T extends ConfigMounts>(configuration: Partial<Configuration<T>>): Promise<void> {
	Object.assign(
		defaultContext.credentials,
		createCredentials({
			uid: configuration.uid || 0,
			gid: configuration.gid || 0,
		})
	);

	_setAccessChecks(!configuration.disableAccessChecks);

	if (configuration.log) log.configure(configuration.log);

	if (configuration.mounts) {
		// sort to make sure any root replacement is done first
		for (const [_point, mountConfig] of Object.entries(configuration.mounts).sort(([a], [b]) => (a.length > b.length ? 1 : -1))) {
			const point = _point.startsWith('/') ? _point : '/' + _point;

			if (isBackendConfig(mountConfig)) {
				mountConfig.disableAsyncCache ??= configuration.disableAsyncCache || false;
				mountConfig.caseFold ??= configuration.caseFold;
			}

			if (point == '/') umount('/');

			await mountWithMkdir(point, await resolveMountConfig(mountConfig));
		}
	}

	for (const fs of mounts.values()) {
		configureFileSystem(fs, configuration);
	}

	if (configuration.addDevices && !mounts.has('/dev')) {
		const devfs = new DeviceFS();
		devfs.addDefaults();
		await devfs.ready();
		await mountWithMkdir('/dev', devfs);
	}

	if (configuration.defaultDirectories) {
		for (const dir of _defaultDirectories) {
			if (await exists(dir)) {
				const stats = await stat(dir);
				if (!stats.isDirectory()) log.warn('Default directory exists but is not a directory: ' + dir);
			} else await mkdir(dir);
		}
	}
}

export async function sync(): Promise<void> {
	for (const fs of mounts.values()) await fs.sync();
}
