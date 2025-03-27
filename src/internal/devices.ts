/*
This is a great resource: https://www.kernel.org/doc/html/latest/admin-guide/devices.html
*/

import { Errno } from 'kerium';
import { debug, err, info } from 'kerium/log';
import { decodeUTF8, omit } from 'utilium';
import { InMemoryStore } from '../backends/memory.js';
import { StoreFS } from '../backends/store/fs.js';
import { basename, dirname } from '../path.js';
import { S_IFCHR } from '../vfs/constants.js';
import { ErrnoError } from './error.js';
import type { CreationOptions } from './filesystem.js';
import { Inode, type InodeLike } from './inode.js';

/**
 * A device
 * @todo Maybe add some other device information, like a UUID?
 * @category Internals
 * @privateRemarks
 * UUIDs were considered, however they don't make sense without an easy mechanism for persistence
 */
export interface Device<TData = any> {
	/**
	 * The device's driver
	 */
	driver: DeviceDriver<TData>;

	/**
	 * Device metadata
	 */
	inode: Inode;

	/**
	 * Data associated with a device.
	 * This is meant to be used by device drivers.
	 */
	data: TData;

	/**
	 * Major device number
	 */
	major: number;

	/**
	 * Minor device number
	 */
	minor: number;
}

/**
 * @category Internals
 */
export interface DeviceInit<TData = any> {
	data?: TData;
	minor?: number;
	major?: number;
	name?: string;
	metadata?: Partial<InodeLike>;
}

/**
 * A device driver
 * @category Internals
 */
export interface DeviceDriver<TData = any> {
	/**
	 * The name of the device driver
	 */
	name: string;

	/**
	 * If true, only a single device can exist per device FS.
	 * Note that if this is unset or false, auto-named devices will have a number suffix
	 */
	singleton?: boolean;

	/**
	 * Initializes a new device.
	 * @returns `Device.data`
	 */
	init?(ino: number, options: object): DeviceInit<TData>;

	/**
	 * Synchronously read from a device.
	 * @privateRemarks
	 * For many devices there is no concept of an offset or end.
	 * For example, /dev/random will be "the same" regardless of where you read from- random data.
	 * @group File operations
	 */
	read(device: Device<TData>, buffer: Uint8Array, offset: number, end: number): void;

	/**
	 * Synchronously write to a device
	 * @group File operations
	 */
	write(device: Device<TData>, buffer: Uint8Array, offset: number): void;

	/**
	 * Sync the device
	 * @group File operations
	 */
	sync?(device: Device<TData>): void;

	/**
	 * Close the device
	 * @group File operations
	 */
	close?(file: Device<TData>): void;
}

/**
 * A temporary file system that manages and interfaces with devices
 * @category Internals
 */
export class DeviceFS extends StoreFS<InMemoryStore> {
	protected readonly devices = new Map<string, Device>();

	protected devicesWithDriver(driver: DeviceDriver<unknown> | string, forceIdentity?: boolean): Device[] {
		if (forceIdentity && typeof driver == 'string') {
			throw err(new ErrnoError(Errno.EINVAL, 'Can not fetch devices using only a driver name'));
		}
		const devs: Device[] = [];
		for (const device of this.devices.values()) {
			if (forceIdentity && device.driver != driver) continue;

			const name = typeof driver == 'string' ? driver : driver.name;

			if (name == device.driver.name) devs.push(device);
		}

		return devs;
	}

	/**
	 * @internal
	 */
	_createDevice<TData = any>(driver: DeviceDriver<TData>, options: object = {}): Device<TData | Record<string, never>> {
		let ino = 1;
		const lastDev = Array.from(this.devices.values()).at(-1);
		while (this.store.has(ino) || lastDev?.inode.ino == ino) ino++;

		const init = driver.init?.(ino, options);

		const dev = {
			data: {},
			minor: 0,
			major: 0,
			...omit(init ?? {}, 'metadata'),
			driver,
			inode: new Inode({
				mode: S_IFCHR | 0o666,
				...init?.metadata,
			}),
		} satisfies Device;

		const path = '/' + (dev.name || driver.name) + (driver.singleton ? '' : this.devicesWithDriver(driver).length);

		if (this.existsSync(path)) throw ErrnoError.With('EEXIST', path, 'mknod');

		this.devices.set(path, dev);

		info('Initialized device: ' + this._mountPoint + path);

		return dev;
	}

	/**
	 * Adds default devices
	 */
	public addDefaults(): void {
		this._createDevice(nullDevice);
		this._createDevice(zeroDevice);
		this._createDevice(fullDevice);
		this._createDevice(randomDevice);
		this._createDevice(consoleDevice);
		debug('Added default devices');
	}

	public constructor() {
		// Please don't store your temporary files in /dev.
		// If you do, you'll have up to 16 MiB
		super(new InMemoryStore(0x1000000, 'devfs'));
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		if (this.devices.has(oldPath)) {
			throw ErrnoError.With('EPERM', oldPath, 'rename');
		}
		if (this.devices.has(newPath)) {
			throw ErrnoError.With('EEXIST', newPath, 'rename');
		}
		return super.rename(oldPath, newPath);
	}

	public renameSync(oldPath: string, newPath: string): void {
		if (this.devices.has(oldPath)) {
			throw ErrnoError.With('EPERM', oldPath, 'rename');
		}
		if (this.devices.has(newPath)) {
			throw ErrnoError.With('EEXIST', newPath, 'rename');
		}
		return super.renameSync(oldPath, newPath);
	}

	public async stat(path: string): Promise<InodeLike> {
		const dev = this.devices.get(path);
		if (dev) return dev.inode;
		return super.stat(path);
	}

	public statSync(path: string): InodeLike {
		const dev = this.devices.get(path);
		if (dev) return dev.inode;
		return super.statSync(path);
	}

	public async touch(path: string, metadata: InodeLike): Promise<void> {
		const dev = this.devices.get(path);
		if (dev) dev.inode.update(metadata);
		else await super.touch(path, metadata);
	}

	public touchSync(path: string, metadata: InodeLike): void {
		const dev = this.devices.get(path);
		if (dev) dev.inode.update(metadata);
		else super.touchSync(path, metadata);
	}

	public async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		if (this.devices.has(path)) throw ErrnoError.With('EEXIST', path, 'createFile');
		return super.createFile(path, options);
	}

	public createFileSync(path: string, options: CreationOptions): InodeLike {
		if (this.devices.has(path)) throw ErrnoError.With('EEXIST', path, 'createFile');
		return super.createFileSync(path, options);
	}

	public async unlink(path: string): Promise<void> {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EPERM', path, 'unlink');
		}
		return super.unlink(path);
	}

	public unlinkSync(path: string): void {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EPERM', path, 'unlink');
		}
		return super.unlinkSync(path);
	}

	public async rmdir(path: string): Promise<void> {
		return super.rmdir(path);
	}

	public rmdirSync(path: string): void {
		return super.rmdirSync(path);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		if (this.devices.has(path)) throw ErrnoError.With('EEXIST', path, 'mkdir');
		return super.mkdir(path, options);
	}

	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		if (this.devices.has(path)) throw ErrnoError.With('EEXIST', path, 'mkdir');
		return super.mkdirSync(path, options);
	}

	public async readdir(path: string): Promise<string[]> {
		const entries = await super.readdir(path);
		for (const dev of this.devices.keys()) {
			if (dirname(dev) == path) {
				entries.push(basename(dev));
			}
		}
		return entries;
	}

	public readdirSync(path: string): string[] {
		const entries = super.readdirSync(path);
		for (const dev of this.devices.keys()) {
			if (dirname(dev) == path) {
				entries.push(basename(dev));
			}
		}
		return entries;
	}

	public async link(target: string, link: string): Promise<void> {
		if (this.devices.has(target)) {
			throw ErrnoError.With('EPERM', target, 'rmdir');
		}
		if (this.devices.has(link)) {
			throw ErrnoError.With('EEXIST', link, 'link');
		}
		return super.link(target, link);
	}

	public linkSync(target: string, link: string): void {
		if (this.devices.has(target)) {
			throw ErrnoError.With('EPERM', target, 'rmdir');
		}
		if (this.devices.has(link)) {
			throw ErrnoError.With('EEXIST', link, 'link');
		}
		return super.linkSync(target, link);
	}

	public async sync(path: string): Promise<void> {
		const device = this.devices.get(path);
		if (device) return device.driver.sync?.(device);
		return super.sync(path);
	}

	public syncSync(path: string): void {
		const device = this.devices.get(path);
		if (device) return device.driver.sync?.(device);
		return super.syncSync(path);
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		const device = this.devices.get(path);
		if (!device) {
			await super.read(path, buffer, offset, end);
			return;
		}

		device.driver.read(device, buffer, offset, end);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		const device = this.devices.get(path);
		if (!device) {
			super.readSync(path, buffer, offset, end);
			return;
		}

		device.driver.read(device, buffer, offset, end);
	}

	public async write(path: string, data: Uint8Array, offset: number): Promise<void> {
		const device = this.devices.get(path);
		if (!device) {
			return await super.write(path, data, offset);
		}

		device.driver.write(device, data, offset);
	}

	public writeSync(path: string, data: Uint8Array, offset: number): void {
		const device = this.devices.get(path);
		if (!device) {
			return super.writeSync(path, data, offset);
		}

		device.driver.write(device, data, offset);
	}
}

const emptyBuffer = new Uint8Array();

/**
 * Simulates the `/dev/null` device.
 * - Reads return 0 bytes (EOF).
 * - Writes discard data, advancing the file position.
 * @category Internals
 * @internal
 */
export const nullDevice: DeviceDriver = {
	name: 'null',
	singleton: true,
	init() {
		return { major: 1, minor: 3 };
	},
	read(): Uint8Array {
		return emptyBuffer;
	},
	write() {
		return;
	},
};

/**
 * Simulates the `/dev/zero` device
 * Provides an infinite stream of zeroes when read.
 * Discards any data written to it.
 *
 * - Reads fill the buffer with zeroes.
 * - Writes discard data but update the file position.
 * - Provides basic file metadata, treating it as a character device.
 * @category Internals
 * @internal
 */
export const zeroDevice: DeviceDriver = {
	name: 'zero',
	singleton: true,
	init() {
		return { major: 1, minor: 5 };
	},
	read(device, buffer, offset, end) {
		buffer.fill(0, offset, end);
	},
	write() {
		return;
	},
};

/**
 * Simulates the `/dev/full` device.
 * - Reads behave like `/dev/zero` (returns zeroes).
 * - Writes always fail with ENOSPC (no space left on device).
 * @category Internals
 * @internal
 */
export const fullDevice: DeviceDriver = {
	name: 'full',
	singleton: true,
	init() {
		return { major: 1, minor: 7 };
	},
	read(device, buffer, offset, end) {
		buffer.fill(0, offset, end);
	},
	write() {
		throw ErrnoError.With('ENOSPC', undefined, 'write');
	},
};

/**
 * Simulates the `/dev/random` device.
 * - Reads return random bytes.
 * - Writes discard data, advancing the file position.
 * @category Internals
 * @internal
 */
export const randomDevice: DeviceDriver = {
	name: 'random',
	singleton: true,
	init() {
		return { major: 1, minor: 8 };
	},
	read(device, buffer) {
		for (let i = 0; i < buffer.length; i++) {
			buffer[i] = Math.floor(Math.random() * 256);
		}
	},
	write() {
		return;
	},
};

/**
 * Simulates the `/dev/console` device.
 * @category Internals
 * @experimental @internal
 */
const consoleDevice: DeviceDriver<{ output: (text: string, offset: number) => unknown }> = {
	name: 'console',
	singleton: true,
	init(ino: number, { output = text => console.log(text) }: { output?: (text: string) => unknown } = {}) {
		return { major: 5, minor: 1, data: { output } };
	},
	read() {
		return emptyBuffer;
	},
	write(device, buffer, offset) {
		const text = decodeUTF8(buffer);
		device.data.output(text, offset);
	},
};

/**
 * Shortcuts for importing.
 * @category Internals
 * @internal
 */
export const devices = {
	null: nullDevice,
	zero: zeroDevice,
	full: fullDevice,
	random: randomDevice,
	console: consoleDevice,
};
