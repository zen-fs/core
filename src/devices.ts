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
