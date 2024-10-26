import type { FileReadResult } from 'node:fs/promises';
import { InMemoryStore } from './backends/memory.js';
import { StoreFS } from './backends/store/fs.js';
import { S_IFBLK, S_IFCHR } from './emulation/constants.js';
import { Errno, ErrnoError } from './error.js';
import { File } from './file.js';
import type { StatsLike } from './stats.js';
import { Stats } from './stats.js';
import { basename, dirname } from './emulation/path.js';
import type { Ino } from './inode.js';

/**
 * A device
 * @todo Maybe add major/minor number or some other device information, like a UUID?
 * @experimental
 */
export interface Device {
	/**
	 * The device's driver
	 */
	driver: DeviceDriver;

	/**
	 * Which inode the device is assigned
	 */
	ino: Ino;
}

/**
 * A device driver
 * @experimental
 */
export interface DeviceDriver {
	/**
	 * The name of the device driver
	 */
	name: string;

	/**
	 * Whether the device is buffered (a "block" device) or unbuffered (a "character" device)
	 */
	isBuffered: boolean;

	/**
	 * Synchronously read from the device
	 */
	read(file: DeviceFile, buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number;

	/**
	 * Synchronously write to the device
	 */
	write(file: DeviceFile, buffer: Uint8Array, offset: number, length: number, position?: number): number;

	/**
	 * Sync the device
	 */
	sync?(file: DeviceFile): void;

	/**
	 * Close the device
	 */
	close?(file: DeviceFile): void;
}

/**
 * The base class for device files
 * This class only does some simple things:
 * It implements `truncate` using `write` and it has non-device methods throw.
 * It is up to device drivers to implement the rest of the functionality.
 * @experimental
 */
export class DeviceFile extends File {
	public position = 0;

	public constructor(
		public fs: DeviceFS,
		path: string,
		public readonly device: Device
	) {
		super(fs, path);
	}

	public get driver(): DeviceDriver {
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
 * @experimental
 */
export class DeviceFS extends StoreFS<InMemoryStore> {
	protected readonly devices = new Map<string, Device>();

	public createDevice(path: string, driver: DeviceDriver): Device {
		if (this.existsSync(path)) {
			throw ErrnoError.With('EEXIST', path, 'mknod');
		}
		let ino = 1n;
		while (this.store.has(ino)) ino++;
		const dev = {
			driver,
			ino,
		};
		this.devices.set(path, dev);
		return dev;
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
		if (this.devices.has(path)) {
			throw ErrnoError.With('ENOTDIR', path, 'rmdir');
		}
		return super.rmdir(path);
	}

	public rmdirSync(path: string): void {
		if (this.devices.has(path)) {
			throw ErrnoError.With('ENOTDIR', path, 'rmdir');
		}
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
		if (this.devices.has(path)) {
			throw ErrnoError.With('ENOTDIR', path, 'readdir');
		}
		const entries = await super.readdir(path);
		for (const dev of this.devices.keys()) {
			if (dirname(dev) == path) {
				entries.push(basename(dev));
			}
		}
		return entries;
	}

	public readdirSync(path: string): string[] {
		if (this.devices.has(path)) {
			throw ErrnoError.With('ENOTDIR', path, 'readdirSync');
		}
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
 * @experimental
 */
export const nullDevice: DeviceDriver = {
	name: 'null',
	isBuffered: false,
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
 * @experimental
 */
export const zeroDevice: DeviceDriver = {
	name: 'zero',
	isBuffered: false,
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
 * @experimental
 */
export const fullDevice: DeviceDriver = {
	name: 'full',
	isBuffered: false,
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
 * @experimental
 */
export const randomDevice: DeviceDriver = {
	name: 'random',
	isBuffered: false,
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
 * Shortcuts for importing.
 * @experimental
 */
export default {
	null: nullDevice,
	zero: zeroDevice,
	full: fullDevice,
	random: randomDevice,
};
