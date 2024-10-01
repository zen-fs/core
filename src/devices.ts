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
 * Simulates the `/dev/zero` device, which provides an infinite stream of zeroes
 * when read, and discards any data written to it.
 *
 * - Reads fill the buffer with zeroes.
 * - Writes discard data but update the file position.
 * - Provides basic file metadata, treating it as a character device.
 */
export class ZeroDeviceFile extends DeviceFile {
	public position = 0;

	protected isBlock = false;

	// eslint-disable-next-line @typescript-eslint/require-await
	public async read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset = 0, length = buffer.byteLength): Promise<FileReadResult<TBuffer>> {
		const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = offset; i < offset + length; i++) {
			data[i] = 0;
		}
		this.position += length;
		return { bytesRead: length, buffer };
	}

	public readSync(buffer: ArrayBufferView, offset = 0, length = buffer.byteLength): number {
		const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = offset; i < offset + length; i++) {
			data[i] = 0;
		}
		this.position += length;
		return length;
	}

	// Writing to /dev/zero discards data, so simply move the file pointer

	// eslint-disable-next-line @typescript-eslint/require-await
	public async write(buffer: Uint8Array, offset = 0, length = buffer.length): Promise<number> {
		this.position += length;
		return length;
	}

	public writeSync(buffer: Uint8Array, offset = 0, length = buffer.length): number {
		this.position += length;
		return length;
	}

	public async close(): Promise<void> {
		// No-op
	}

	public closeSync(): void {
		// No-op
	}

	public async sync(): Promise<void> {
		// No-op
	}

	public syncSync(): void {
		// No-op
	}
}
