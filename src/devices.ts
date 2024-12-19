/*
This is a great resource: https://www.kernel.org/doc/html/latest/admin-guide/devices.html
*/

import type { FileReadResult } from 'node:fs/promises';
import { InMemoryStore } from './backends/memory.js';
import { StoreFS } from './backends/store/fs.js';
import { S_IFBLK, S_IFCHR } from './emulation/constants.js';
import { Errno, ErrnoError } from './error.js';
import { File } from './file.js';
import type { StatsLike } from './stats.js';
import { Stats } from './stats.js';
import { basename, dirname } from './emulation/path.js';
import { decodeUTF8 } from './utils.js';

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
	driver: DeviceDriver;

	/**
	 * Which inode the device is assigned
	 */
	ino: bigint;

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
	init?(
		ino: bigint,
		options: object
	): {
		data?: TData;
		minor?: number;
		major?: number;
		name?: string;
	};

	/**
	 * Synchronously read from the device
	 * @group File operations
	 */
	read(file: DeviceFile<TData>, buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number;

	/**
	 * Synchronously write to the device
	 * @group File operations
	 */
	write(file: DeviceFile<TData>, buffer: Uint8Array, offset: number, length: number, position?: number): number;

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

	protected get stats(): Partial<StatsLike> {
		return { mode: (this.driver.isBuffered ? S_IFBLK : S_IFCHR) | 0o666 };
	}

	public async stat(): Promise<Stats> {
		return Promise.resolve(new Stats(this.stats));
	}

	public statSync(): Stats {
		return new Stats(this.stats);
	}

	public readSync(buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number {
		return this.driver.read(this, buffer, offset, length, position);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number): Promise<FileReadResult<TBuffer>> {
		return { bytesRead: this.readSync(buffer, offset, length), buffer };
	}

	public writeSync(buffer: Uint8Array, offset = 0, length = buffer.length, position?: number): number {
		return this.driver.write(this, buffer, offset, length, position);
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

	public _setType(): Promise<void> {
		throw ErrnoError.With('ENOTSUP', this.path, '_setType');
	}

	public _setTypeSync(): void {
		throw ErrnoError.With('ENOTSUP', this.path, '_setType');
	}
}

/**
 * A temporary file system that manages and interfaces with devices
 */
export class DeviceFS extends StoreFS<InMemoryStore> {
	protected readonly devices = new Map<string, Device>();

	/**
	 * Creates a new device at `path` relative to the `DeviceFS` root.
	 * @deprecated
	 */
	public createDevice<TData = any>(path: string, driver: DeviceDriver<TData>, options: object = {}): Device<TData | Record<string, never>> {
		if (this.existsSync(path)) {
			throw ErrnoError.With('EEXIST', path, 'mknod');
		}
		let ino = BigInt(1) as 1n;
		while (this.store.has(ino)) ino++;
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

	protected devicesWithDriver(driver: DeviceDriver<unknown> | string, forceIdentity?: boolean): Device[] {
		if (forceIdentity && typeof driver == 'string') {
			throw new ErrnoError(Errno.EINVAL, 'Can not fetch devices using only a driver name');
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
		let ino = BigInt(1) as 1n;
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
		if (this.existsSync(path)) {
			throw ErrnoError.With('EEXIST', path, 'mknod');
		}
		this.devices.set(path, dev);
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

	public async createFile(path: string, flag: string, mode: number): Promise<File> {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EEXIST', path, 'createFile');
		}
		return super.createFile(path, flag, mode);
	}

	public createFileSync(path: string, flag: string, mode: number): File {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EEXIST', path, 'createFile');
		}
		return super.createFileSync(path, flag, mode);
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

	public async mkdir(path: string, mode: number): Promise<void> {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}
		return super.mkdir(path, mode);
	}

	public mkdirSync(path: string, mode: number): void {
		if (this.devices.has(path)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}
		return super.mkdirSync(path, mode);
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
			throw new ErrnoError(Errno.EINVAL, 'Attempted to sync a device incorrectly (bug)', path, 'sync');
		}
		return super.sync(path, data, stats);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		if (this.devices.has(path)) {
			throw new ErrnoError(Errno.EINVAL, 'Attempted to sync a device incorrectly (bug)', path, 'sync');
		}
		return super.syncSync(path, data, stats);
	}
}

function defaultWrite(file: DeviceFile, buffer: Uint8Array, offset: number, length: number): number {
	file.position += length;
	return length;
}

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
	write: defaultWrite,
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
	read(file: DeviceFile, buffer: ArrayBufferView, offset = 0, length = buffer.byteLength): number {
		const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = offset; i < offset + length; i++) {
			data[i] = 0;
		}
		file.position += length;
		return length;
	},
	write: defaultWrite,
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
	read(file: DeviceFile, buffer: ArrayBufferView, offset = 0, length = buffer.byteLength): number {
		const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = offset; i < offset + length; i++) {
			data[i] = 0;
		}
		file.position += length;
		return length;
	},

	write(file: DeviceFile): number {
		throw ErrnoError.With('ENOSPC', file.path, 'write');
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
	read(file: DeviceFile, buffer: ArrayBufferView, offset = 0, length = buffer.byteLength): number {
		const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = offset; i < offset + length; i++) {
			data[i] = Math.floor(Math.random() * 256);
		}
		file.position += length;
		return length;
	},
	write: defaultWrite,
};

/**
 * Simulates the `/dev/console` device.
 * @experimental @internal
 */
const consoleDevice: DeviceDriver<{ output: (text: string) => unknown }> = {
	name: 'console',
	singleton: true,
	init(ino: bigint, { output = console.log }: { output?: (text: string) => unknown } = {}) {
		return { major: 5, minor: 1, data: { output } };
	},

	read(): number {
		return 0;
	},

	write(file, buffer: Uint8Array, offset: number, length: number): number {
		const text = decodeUTF8(buffer.slice(offset, offset + length));
		file.device.data.output(text);
		file.position += length;
		return length;
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
