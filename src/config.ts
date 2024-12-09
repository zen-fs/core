import type { Backend, BackendConfiguration, FilesystemOf, SharedConfig } from './backends/backend.js';
import { checkOptions, isBackend, isBackendConfig } from './backends/backend.js';
import { useCredentials } from './credentials.js';
import { DeviceFS, type Device, type DeviceDriver } from './devices.js';
import * as cache from './emulation/cache.js';
import { config } from './emulation/config.js';
import * as fs from './emulation/index.js';
import { mounts } from './emulation/shared.js';
import { Errno, ErrnoError } from './error.js';
import { FileSystem } from './filesystem.js';

/**
 * Configuration for a specific mount point
 */
export type MountConfiguration<T extends Backend> = FilesystemOf<T> | BackendConfiguration<T> | T;

function isMountConfig<T extends Backend>(arg: unknown): arg is MountConfiguration<T> {
	return isBackendConfig(arg) || isBackend(arg) || arg instanceof FileSystem;
}

/**
 * Retrieve a file system with `configuration`.
 * @see MountConfiguration
 */
export async function resolveMountConfig<T extends Backend>(configuration: MountConfiguration<T>, _depth = 0): Promise<FilesystemOf<T>> {
	if (typeof configuration !== 'object' || configuration == null) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid options on mount configuration');
	}

	if (!isMountConfig(configuration)) {
		throw new ErrnoError(Errno.EINVAL, 'Invalid mount configuration');
	}

	if (configuration instanceof FileSystem) {
		await configuration.ready();
		return configuration;
	}

	if (isBackend(configuration)) {
		configuration = { backend: configuration } as BackendConfiguration<T>;
	}

	for (const [key, value] of Object.entries(configuration)) {
		if (key == 'backend') {
			continue;
		}

		if (!isMountConfig(value)) {
			continue;
		}

		if (_depth > 10) {
			throw new ErrnoError(Errno.EINVAL, 'Invalid configuration, too deep and possibly infinite');
		}

		(configuration as Record<string, FileSystem>)[key] = await resolveMountConfig(value, ++_depth);
	}

	const { backend } = configuration;

	if (typeof backend.isAvailable == 'function' && !(await backend.isAvailable())) {
		throw new ErrnoError(Errno.EPERM, 'Backend not available: ' + backend.name);
	}
	await checkOptions(backend, configuration);
	const mount = (await backend.create(configuration)) as FilesystemOf<T>;
	mount._disableSync = configuration.disableAsyncCache || false;
	await mount.ready();
	return mount;
}

/**
 * An object mapping mount points to backends
 */
export interface ConfigMounts {
	[K: string]: Backend;
}

/**
 * Configuration
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
	 * @experimental
	 * @default false
	 */
	addDevices: boolean;

	/**
	 * If true, enables caching stats for certain operations.
	 * This should reduce the number of stat calls performed.
	 * @experimental
	 * @default false
	 */
	cacheStats: boolean;

	/**
	 * If true, enables caching realpath output
	 *
	 * This can increase performance.
	 * @experimental
	 * @default false
	 */
	cachePaths: boolean;

	/**
	 * If true, disables *all* permissions checking.
	 *
	 * This can increase performance.
	 * @experimental
	 * @default false
	 */
	disableAccessChecks: boolean;

	/**
	 * If true, disables `read` and `readSync` from updating the atime.
	 *
	 * This can increase performance.
	 * @experimental
	 * @default false
	 */
	disableUpdateOnRead: boolean;

	/**
	 * If true, files will only sync to the file system when closed.
	 *
	 * This can increase performance.
	 * @experimental
	 * @overrides `disableUpdateOnRead`
	 * @default false
	 */
	onlySyncOnClose: boolean;
}

/**
 * Configures ZenFS with single mount point /
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
 * This is implemented as a separate function to avoid a circular dependency between emulation/shared.ts and other emulation layer files.
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

export function addDevice(driver: DeviceDriver, options?: object): Device {
	const devfs = mounts.get('/dev');
	if (!(devfs instanceof DeviceFS)) throw new ErrnoError(Errno.ENOTSUP, '/dev does not exist or is not a device file system');
	return devfs._createDevice(driver, options);
}

/**
 * Configures ZenFS with `configuration`
 * @see Configuration
 */
export async function configure<T extends ConfigMounts>(configuration: Partial<Configuration<T>>): Promise<void> {
	const uid = 'uid' in configuration ? configuration.uid || 0 : 0;
	const gid = 'gid' in configuration ? configuration.gid || 0 : 0;

	useCredentials({ uid, gid });

	cache.stats.isEnabled = configuration.cacheStats ?? false;
	cache.paths.isEnabled = configuration.cachePaths ?? false;
	config.checkAccess = !configuration.disableAccessChecks;
	config.updateOnRead = !configuration.disableUpdateOnRead;
	config.syncImmediately = !configuration.onlySyncOnClose;

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
