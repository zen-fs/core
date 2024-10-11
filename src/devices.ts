import type { FileReadResult } from 'fs/promises';
import { S_IFBLK, S_IFCHR } from './emulation/constants.js';
import { ErrnoError } from './error.js';
import { File } from './file.js';
import type { FileType, StatsLike } from './stats.js';
import { Stats } from './stats.js';

/**
 * The base class for device files
 * This class only does some simple things:
 * It implements `truncate` using `write` and it has non-device methods throw.
 * It is up to device drivers to implement the rest of the functionality.
 */
export abstract class DeviceFile extends File {
	public position = 0;

	protected abstract isBlock: boolean;

	protected get stats(): Partial<StatsLike> {
		return { mode: (this.isBlock ? S_IFBLK : S_IFCHR) | 0o666 };
	}

	public async stat(): Promise<Stats> {
		return Promise.resolve(new Stats(this.stats));
	}

	public statSync(): Stats {
		return new Stats(this.stats);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number): Promise<FileReadResult<TBuffer>> {
		return { bytesRead: this.readSync(buffer, offset, length), buffer };
	}

	/**
	 * Default write, increments the file position.
	 * This is implemented in order to make adding new devices easier.
	 */
	public writeSync(buffer: Uint8Array, offset = 0, length = buffer.length, position?: number): number {
		this.position += length;
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

	/**
	 * Default close, does nothing.
	 */
	public closeSync(): void {}

	public async close(): Promise<void> {
		this.closeSync();
	}

	/**
	 * Default sync, does nothing.
	 */
	public syncSync(): void {}

	public async sync(): Promise<void> {
		this.syncSync();
	}

	/* eslint-disable @typescript-eslint/no-unused-vars */
	public chown(uid: number, gid: number): Promise<void> {
		throw ErrnoError.With('ENOTSUP', this.path, 'chown');
	}

	public chownSync(uid: number, gid: number): void {
		throw ErrnoError.With('ENOTSUP', this.path, 'chown');
	}

	public chmod(mode: number): Promise<void> {
		throw ErrnoError.With('ENOTSUP', this.path, 'chmod');
	}

	public chmodSync(mode: number): void {
		throw ErrnoError.With('ENOTSUP', this.path, 'chmod');
	}

	public utimes(atime: Date, mtime: Date): Promise<void> {
		throw ErrnoError.With('ENOTSUP', this.path, 'utimes');
	}

	public utimesSync(atime: Date, mtime: Date): void {
		throw ErrnoError.With('ENOTSUP', this.path, 'utimes');
	}

	public _setType(type: FileType): Promise<void> {
		throw ErrnoError.With('ENOTSUP', this.path, '_setType');
	}

	public _setTypeSync(type: FileType): void {
		throw ErrnoError.With('ENOTSUP', this.path, '_setType');
	}
	/* eslint-enable @typescript-eslint/no-unused-vars */
}

/**
 * Simulates the `/dev/null` device.
 * - Reads return 0 bytes (EOF).
 * - Writes discard data, advancing the file position.
 */
export class NullDevice extends DeviceFile {
	protected isBlock = false;

	// Reading from /dev/null returns EOF immediately, so return 0.
	public readSync(): number {
		return 0;
	}
}

/**
 * Simulates the `/dev/zero` device
 * Provides an infinite stream of zeroes when read.
 * Discards any data written to it.
 *
 * - Reads fill the buffer with zeroes.
 * - Writes discard data but update the file position.
 * - Provides basic file metadata, treating it as a character device.
 */
export class ZeroDevice extends DeviceFile {
	protected isBlock = false;

	public readSync(buffer: ArrayBufferView, offset = 0, length = buffer.byteLength): number {
		const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = offset; i < offset + length; i++) {
			data[i] = 0;
		}
		this.position += length;
		return length;
	}
}

/**
 * Simulates the `/dev/full` device.
 * - Reads behave like `/dev/zero` (returns zeroes).
 * - Writes always fail with ENOSPC (no space left on device).
 */
export class FullDevice extends DeviceFile {
	protected isBlock = false;

	public readSync(buffer: ArrayBufferView, offset = 0, length = buffer.byteLength): number {
		const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = offset; i < offset + length; i++) {
			data[i] = 0;
		}
		this.position += length;
		return length;
	}

	public writeSync(): number {
		throw ErrnoError.With('ENOSPC', this.path, 'write');
	}
}

/**
 * Simulates the `/dev/random` device.
 * - Reads return random bytes.
 * - Writes discard data, advancing the file position.
 */
export class RandomDevice extends DeviceFile {
	protected isBlock = false;

	// Fill buffer with random bytes
	public readSync(buffer: ArrayBufferView, offset = 0, length = buffer.byteLength): number {
		const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = offset; i < offset + length; i++) {
			data[i] = Math.floor(Math.random() * 256);
		}
		this.position += length;
		return length;
	}
}

/**
 * Shortcut when importing.
 * @example
 * ```ts
 * import { devices } from '@zenfs/core'
 * // ...
 * const myDevFS = InMemory.create({ name: 'devfs' });
 * const myRNG = new devices.Random(myDevFS, '/dev/random2');
 * ```
 */
export default {
	Null: NullDevice,
	Zero: ZeroDevice,
	Full: FullDevice,
	RandomDevice: RandomDevice,
};
