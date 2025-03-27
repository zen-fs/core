import { Errno, log } from 'kerium';
import type { Backend, BackendConfiguration, FilesystemOf, SharedConfig } from './backends/backend.js';
import { checkOptions, isBackend, isBackendConfig } from './backends/backend.js';
import { defaultContext } from './internal/contexts.js';
import { createCredentials } from './internal/credentials.js';
import type { Device, DeviceDriver } from './internal/devices.js';
import { DeviceFS } from './internal/devices.js';
import { ErrnoError } from './internal/error.js';
import { FileSystem } from './internal/filesystem.js';
import { _setAccessChecks } from './vfs/config.js';
import * as fs from './vfs/index.js';
import { mounts } from './vfs/shared.js';

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
		throw log.err(new ErrnoError(Errno.EINVAL, 'Invalid options on mount configuration'));
	}

	if (!isMountConfig(configuration)) {
		throw log.err(new ErrnoError(Errno.EINVAL, 'Invalid mount configuration'));
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
			throw log.err(new ErrnoError(Errno.EINVAL, 'Invalid configuration, too deep and possibly infinite'));
		}

		(configuration as Record<string, FileSystem>)[key] = await resolveMountConfig(value, ++_depth);
	}

	const { backend } = configuration;

	if (typeof backend.isAvailable == 'function' && !(await backend.isAvailable(configuration))) {
		throw log.err(new ErrnoError(Errno.EPERM, 'Backend not available: ' + backend.name));
	}

	checkOptions(backend, configuration);
	const mount = (await backend.create(configuration)) as FilesystemOf<T>;
	if (configuration.disableAsyncCache) mount.attributes.set('no_async');
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
	if (!isBackendConfig(configuration)) {
		throw new TypeError('Invalid single mount point configuration');
	}

	const resolved = await resolveMountConfig(configuration);
	fs.umount('/');
	fs.mount('/', resolved);
}

/**
 * Like `fs.mount`, but it also creates missing directories.
 * @privateRemarks
 * This is implemented as a separate function to avoid a circular dependency between vfs/shared.ts and other vfs layer files.
 * @internal
 */
async function mount(path: string, mount: FileSystem): Promise<void> {
	if (path == '/') {
		fs.mount(path, mount);
		return;
	}

	const stats = await fs.promises.stat(path).catch(() => null);
	if (!stats) {
		await fs.promises.mkdir(path, { recursive: true });
	} else if (!stats.isDirectory()) {
		throw ErrnoError.With('ENOTDIR', path, 'configure');
	}
	fs.mount(path, mount);
}

/**
 * @category Backends and Configuration
 */
export function addDevice(driver: DeviceDriver, options?: object): Device {
	const devfs = mounts.get('/dev');
	if (!(devfs instanceof DeviceFS)) throw log.crit(new ErrnoError(Errno.ENOTSUP, '/dev does not exist or is not a device file system'));
	return devfs._createDevice(driver, options);
}

/**
 * Configures ZenFS with `configuration`
 * @category Backends and Configuration
 * @see Configuration
 */
export async function configure<T extends ConfigMounts>(configuration: Partial<Configuration<T>>): Promise<void> {
	const uid = 'uid' in configuration ? configuration.uid || 0 : 0;
	const gid = 'gid' in configuration ? configuration.gid || 0 : 0;

	Object.assign(defaultContext.credentials, createCredentials({ uid, gid }));

	_setAccessChecks(!configuration.disableAccessChecks);

	if (configuration.log) log.configure(configuration.log);

	if (configuration.mounts) {
		// sort to make sure any root replacement is done first
		for (const [_point, mountConfig] of Object.entries(configuration.mounts).sort(([a], [b]) => (a.length > b.length ? 1 : -1))) {
			const point = _point.startsWith('/') ? _point : '/' + _point;

			if (isBackendConfig(mountConfig)) {
				mountConfig.disableAsyncCache ??= configuration.disableAsyncCache || false;
			}

			if (point == '/') fs.umount('/');

			await mount(point, await resolveMountConfig(mountConfig));
		}
	}

	if (configuration.addDevices) {
		const devfs = new DeviceFS();
		devfs.addDefaults();
		await devfs.ready();
		await mount('/dev', devfs);
	}
}
