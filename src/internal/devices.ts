/*
This is a great resource: https://www.kernel.org/doc/html/latest/admin-guide/devices.html
*/

import { canary } from 'utilium';
import { InMemoryStore } from '../backends/memory.js';
import { StoreFS } from '../backends/store/fs.js';
import { Stats } from '../stats.js';
import { decodeUTF8 } from '../utils.js';
import { S_IFBLK, S_IFCHR } from '../vfs/constants.js';
import { basename, dirname } from '../vfs/path.js';
import { Errno, ErrnoError } from './error.js';
import type { FileReadResult } from './file.js';
import { File } from './file.js';
import type { CreationOptions } from './filesystem.js';
import { Inode } from './inode.js';
import { alert, debug, err, info, log_deprecated } from './log.js';

/**
 * A device
 * @todo Maybe add some other device information, like a UUID?
 * @privateRemarks
 * UUIDs were considered, however they don't make sense without an easy mechanism for persistence
 */
export interface Device<TData = any> {
	/**
	 * The device's driver
	 */
	driver: DeviceDriver<TData>;

	/**
	 * Which inode the device is assigned
	 */
	ino: number;

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

export interface DeviceInit<TData = any> {
	data?: TData;
	minor?: number;
	major?: number;
	name?: string;
}

/**
 * A device driver
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
	 * Whether the device is buffered (a "block" device) or unbuffered (a "character" device)
	 * @default false
	 */
	isBuffered?: boolean;

	/**
	 * Initializes a new device.
	 * @returns `Device.data`
	 */
	init?(ino: number, options: object): DeviceInit<TData>;

	/**
	 * Synchronously read from a device file
	 * @group File operations
	 * @deprecated
	 * @todo [BREAKING] Remove
	 */
	read?(file: DeviceFile<TData>, buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number;

	/**
	 * Synchronously read from a device.
	 * @privateRemarks
	 * For many devices there is no concept of an offset or end.
	 * For example, /dev/random will be "the same" regardless of where you read from- random data.
	 * @group File operations
	 * @todo [BREAKING] Rename to `read`
	 */
	readD(device: Device<TData>, buffer: Uint8Array, offset: number, end: number): void;

	/**
	 * Synchronously write to a device file
	 * @group File operations
	 * @deprecated
	 * @todo [BREAKING] Remove
	 */
	write?(file: DeviceFile<TData>, buffer: Uint8Array, offset: number, length: number, position?: number): number;

	/**
	 * Synchronously write to a device
	 * @group File operations
	 * @todo [BREAKING] Rename to `write`
	 */
	writeD(device: Device<TData>, buffer: Uint8Array, offset: number): void;

	/**
	 * Sync the device
	 * @group File operations
	 */
	sync?(file: DeviceFile<TData>): void;

	/**
	 * Close the device
	 * @group File operations
	 */
	close?(file: DeviceFile<TData>): void;
}

/**
 * The base class for device files
 * This class only does some simple things:
 * It implements `truncate` using `write` and it has non-device methods throw.
 * It is up to device drivers to implement the rest of the functionality.
 */
export class DeviceFile<TData = any> extends File {
	public position = 0;

	public constructor(
		public fs: DeviceFS,
		path: string,
		public readonly device: Device<TData>
	) {
		super(fs, path);
	}

	public get driver(): DeviceDriver<TData> {
		return this.device.driver;
	}

	protected stats = new Inode({
		mode: (this.driver.isBuffered ? S_IFBLK : S_IFCHR) | 0o666,
	});

	public async stat(): Promise<Stats> {
		return Promise.resolve(new Stats(this.stats));
	}

	public statSync(): Stats {
		return new Stats(this.stats);
	}

	public readSync(
		buffer: ArrayBufferView,
		offset: number = 0,
		length: number = buffer.byteLength - offset,
		position: number = this.position
	): number {
		this.stats.atimeMs = Date.now();

		const end = position + length;
		this.position = end;

		const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		this.driver.readD(this.device, uint8.subarray(offset, length), position, end);

		return length;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async read<TBuffer extends ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number): Promise<FileReadResult<TBuffer>> {
		return { bytesRead: this.readSync(buffer, offset, length), buffer };
	}

	public writeSync(buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset, position: number = this.position): number {
		const end = position + length;

		if (end > this.stats.size) this.stats.size = end;

		this.stats.mtimeMs = Date.now();
		this.position = end;

		const data = buffer.subarray(offset, offset + length);

		this.driver.writeD(this.device, data, position);

		return length;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number> {
		return this.writeSync(buffer, offset, length, position);
	}

	public async truncate(length: number): Promise<void> {
		const { size } = await this.stat();

		const buffer = new Uint8Array(length > size ? length - size : 0);

		await this.write(buffer, 0, buffer.length, length > size ? size : length);
	}

	public truncateSync(length: number): void {
		const { size } = this.statSync();

		const buffer = new Uint8Array(length > size ? length - size : 0);

		this.writeSync(buffer, 0, buffer.length, length > size ? size : length);
	}

	public closeSync(): void {
		this.driver.close?.(this);
	}

	public close(): Promise<void> {
		this.closeSync();
		return Promise.resolve();
	}

	public syncSync(): void {
		this.driver.sync?.(this);
	}

	public sync(): Promise<void> {
		this.syncSync();
		return Promise.resolve();
	}

	public chown(): Promise<void> {
		throw ErrnoError.With('ENOTSUP', this.path, 'chown');
	}

	public chownSync(): void {
		throw ErrnoError.With('ENOTSUP', this.path, 'chown');
	}

	public chmod(): Promise<void> {
		throw ErrnoError.With('ENOTSUP', this.path, 'chmod');
	}

	public chmodSync(): void {
		throw ErrnoError.With('ENOTSUP', this.path, 'chmod');
	}

	public utimes(): Promise<void> {
		throw ErrnoError.With('ENOTSUP', this.path, 'utimes');
	}

	public utimesSync(): void {
		throw ErrnoError.With('ENOTSUP', this.path, 'utimes');
	}
}

/**
 * A temporary file system that manages and interfaces with devices
 */
export class DeviceFS extends StoreFS<InMemoryStore> {
	protected readonly devices = new Map<string, Device>();

	/* node:coverage disable */
	/**
	 * Creates a new device at `path` relative to the `DeviceFS` root.
	 * @deprecated
	 */
	public createDevice<TData = any>(path: string, driver: DeviceDriver<TData>, options: object = {}): Device<TData | Record<string, never>> {
		log_deprecated('DeviceFS#createDevice');
		if (this.existsSync(path)) {
			throw ErrnoError.With('EEXIST', path, 'mknod');
		}
		let ino = 1;
		const silence = canary(ErrnoError.With('EDEADLK', path, 'mknod'));
		while (this.store.has(ino)) ino++;
		silence();
		const dev = {
			driver,
			ino,
			data: {},
			minor: 0,
			major: 0,
			...driver.init?.(ino, options),
		};
		this.devices.set(path, dev);
		return dev;
	}
	/* node:coverage enable */

	protected devicesWithDriver(driver: DeviceDriver<unknown> | string, forceIdentity?: boolean): Device[] {
		if (forceIdentity && typeof driver == 'string') {
			throw err(new ErrnoError(Errno.EINVAL, 'Can not fetch devices using only a driver name'), { fs: this });
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
		while (this.store.has(ino)) ino++;
		const dev = {
			driver,
			ino,
			data: {},
			minor: 0,
			major: 0,
			...driver.init?.(ino, options),
		};
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
		debug('Added default devices.');
	}

	public constructor() {
		super(new InMemoryStore('devfs'));
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

	public async stat(path: string): Promise<Stats> {
		if (this.devices.has(path)) {
			await using file = await this.openFile(path, 'r');
			return file.stat();
		}
		return super.stat(path);
	}

	public statSync(path: string): Stats {
		if (this.devices.has(path)) {
			using file = this.openFileSync(path, 'r');
			return file.statSync();
		}
		return super.statSync(path);
	}

	public async openFile(path: string, flag: string): Promise<File> {
		if (this.devices.has(path)) {
			return new DeviceFile(this, path, this.devices.get(path)!);
		}
		return await super.openFile(path, flag);
	}

	public openFileSync(path: string, flag: string): File {
		if (this.devices.has(path)) {
			return new DeviceFile(this, path, this.devices.get(path)!);
		}
		return super.openFileSync(path, flag);
	}

	public async createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File> {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EEXIST', path, 'createFile');
		}
		return super.createFile(path, flag, mode, options);
	}

	public createFileSync(path: string, flag: string, mode: number, options: CreationOptions): File {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EEXIST', path, 'createFile');
		}
		return super.createFileSync(path, flag, mode, options);
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

	public async mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}
		return super.mkdir(path, mode, options);
	}

	public mkdirSync(path: string, mode: number, options: CreationOptions): void {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}
		return super.mkdirSync(path, mode, options);
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

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		if (this.devices.has(path)) {
			throw alert(new ErrnoError(Errno.EINVAL, 'Attempted to sync a device incorrectly (bug)', path, 'sync'), { fs: this });
		}
		return super.sync(path, data, stats);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		if (this.devices.has(path)) {
			throw alert(new ErrnoError(Errno.EINVAL, 'Attempted to sync a device incorrectly (bug)', path, 'sync'), { fs: this });
		}
		return super.syncSync(path, data, stats);
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		const device = this.devices.get(path);
		if (!device) {
			await super.read(path, buffer, offset, end);
			return;
		}

		device.driver.readD(device, buffer, offset, end);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		const device = this.devices.get(path);
		if (!device) {
			super.readSync(path, buffer, offset, end);
			return;
		}

		device.driver.readD(device, buffer, offset, end);
	}

	public async write(path: string, data: Uint8Array, offset: number): Promise<void> {
		const device = this.devices.get(path);
		if (!device) {
			return await super.write(path, data, offset);
		}

		device.driver.writeD(device, data, offset);
	}

	public writeSync(path: string, data: Uint8Array, offset: number): void {
		const device = this.devices.get(path);
		if (!device) {
			return super.writeSync(path, data, offset);
		}

		device.driver.writeD(device, data, offset);
	}
}

function defaultWrite(device: Device, data: Uint8Array, offset: number) {
	return;
}

const emptyBuffer = new Uint8Array();

/**
 * Simulates the `/dev/null` device.
 * - Reads return 0 bytes (EOF).
 * - Writes discard data, advancing the file position.
 * @internal
 */
export const nullDevice: DeviceDriver = {
	name: 'null',
	singleton: true,
	init() {
		return { major: 1, minor: 3 };
	},
	read(): number {
		return 0;
	},
	readD(): Uint8Array {
		return emptyBuffer;
	},
	writeD: defaultWrite,
};

/**
 * Simulates the `/dev/zero` device
 * Provides an infinite stream of zeroes when read.
 * Discards any data written to it.
 *
 * - Reads fill the buffer with zeroes.
 * - Writes discard data but update the file position.
 * - Provides basic file metadata, treating it as a character device.
 * @internal
 */
export const zeroDevice: DeviceDriver = {
	name: 'zero',
	singleton: true,
	init() {
		return { major: 1, minor: 5 };
	},
	readD(device, buffer, offset, end) {
		buffer.fill(0, offset, end);
	},
	writeD: defaultWrite,
};

/**
 * Simulates the `/dev/full` device.
 * - Reads behave like `/dev/zero` (returns zeroes).
 * - Writes always fail with ENOSPC (no space left on device).
 * @internal
 */
export const fullDevice: DeviceDriver = {
	name: 'full',
	singleton: true,
	init() {
		return { major: 1, minor: 7 };
	},
	readD(device, buffer, offset, end) {
		buffer.fill(0, offset, end);
	},
	write(file: DeviceFile): number {
		throw ErrnoError.With('ENOSPC', file.path, 'write');
	},
	writeD() {
		throw ErrnoError.With('ENOSPC', undefined, 'write');
	},
};

/**
 * Simulates the `/dev/random` device.
 * - Reads return random bytes.
 * - Writes discard data, advancing the file position.
 * @internal
 */
export const randomDevice: DeviceDriver = {
	name: 'random',
	singleton: true,
	init() {
		return { major: 1, minor: 8 };
	},
	readD(device, buffer) {
		for (let i = 0; i < buffer.length; i++) {
			buffer[i] = Math.floor(Math.random() * 256);
		}
	},
	writeD: defaultWrite,
};

/**
 * Simulates the `/dev/console` device.
 * @experimental @internal
 */
const consoleDevice: DeviceDriver<{ output: (text: string, offset: number) => unknown }> = {
	name: 'console',
	singleton: true,
	init(ino: number, { output = text => console.log(text) }: { output?: (text: string) => unknown } = {}) {
		return { major: 5, minor: 1, data: { output } };
	},
	readD() {
		return emptyBuffer;
	},
	writeD(device, buffer, offset) {
		const text = decodeUTF8(buffer);
		device.data.output(text, offset);
	},
};

/**
 * Shortcuts for importing.
 */
export const devices = {
	null: nullDevice,
	zero: zeroDevice,
	full: fullDevice,
	random: randomDevice,
	console: consoleDevice,
};
