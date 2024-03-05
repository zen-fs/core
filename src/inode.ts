import { S_IFMT } from './emulation/constants.js';
import { Stats, FileType } from './stats.js';

enum Offset {
	ino = 0,
	size = 8, // offsets with a 64-bit size
	mode = 12, // 16
	nlink = 14, // 18
	uid = 18, // 22
	gid = 22, // 26
	atime = 26, // 30
	mtime = 34, // 38
	ctime = 42, // 46
}

export type Ino = bigint;

export const size_max = 2 ** 32 - 1;

/**
 * Generic inode definition that can easily be serialized.
 */
export default class Inode {
	public readonly buffer: ArrayBufferLike;

	public get data(): Uint8Array {
		return new Uint8Array(this.buffer);
	}

	protected view: DataView;

	constructor(buffer?: ArrayBufferLike) {
		const setDefaults = !buffer;
		buffer ??= new ArrayBuffer(50);
		this.view = new DataView(buffer);
		this.buffer = buffer;

		if (!setDefaults) {
			return;
		}

		// set defaults on a fresh inode
		this.ino = randomIno();
		this.nlink = 1;
		this.size = 4096;
		const now = Date.now();
		this.atime = now;
		this.mtime = now;
		this.ctime = now;
	}

	public get ino(): Ino {
		return this.view.getBigUint64(Offset.ino, true);
	}

	public set ino(value: Ino) {
		this.view.setBigUint64(Offset.ino, value, true);
	}

	public get size(): number {
		return this.view.getUint32(Offset.size, true);
	}

	public set size(value: number) {
		this.view.setUint32(Offset.size, value, true);
	}

	public get mode(): number {
		return this.view.getUint16(Offset.mode, true);
	}

	public set mode(value: number) {
		this.view.setUint16(Offset.mode, value, true);
	}

	public get nlink(): number {
		return this.view.getUint32(Offset.nlink, true);
	}

	public set nlink(value: number) {
		this.view.setUint32(Offset.nlink, value, true);
	}

	public get uid(): number {
		return this.view.getUint32(Offset.uid, true);
	}

	public set uid(value: number) {
		this.view.setUint32(Offset.uid, value, true);
	}

	public get gid(): number {
		return this.view.getUint32(Offset.gid, true);
	}

	public set gid(value: number) {
		this.view.setUint32(Offset.gid, value, true);
	}

	public get atime(): number {
		return this.view.getFloat64(Offset.atime, true);
	}

	public set atime(value: number) {
		this.view.setFloat64(Offset.atime, value, true);
	}

	public get mtime(): number {
		return this.view.getFloat64(Offset.mtime, true);
	}

	public set mtime(value: number) {
		this.view.setFloat64(Offset.mtime, value, true);
	}

	public get ctime(): number {
		return this.view.getFloat64(Offset.ctime, true);
	}

	public set ctime(value: number) {
		this.view.setFloat64(Offset.ctime, value, true);
	}

	/**
	 * Handy function that converts the Inode to a Node Stats object.
	 */
	public toStats(): Stats {
		return new Stats(
			(this.mode & S_IFMT) === FileType.DIRECTORY ? FileType.DIRECTORY : FileType.FILE,
			this.size,
			this.mode,
			this.atime,
			this.mtime,
			this.ctime,
			this.uid,
			this.gid
		);
	}

	/**
	 * Get the size of this Inode, in bytes.
	 */
	public sizeof(): number {
		return this.buffer.byteLength;
	}

	/**
	 * Updates the Inode using information from the stats object. Used by file
	 * systems at sync time, e.g.:
	 * - Program opens file and gets a File object.
	 * - Program mutates file. File object is responsible for maintaining
	 *   metadata changes locally -- typically in a Stats object.
	 * - Program closes file. File object's metadata changes are synced with the
	 *   file system.
	 * @return True if any changes have occurred.
	 */
	public update(stats: Readonly<Stats>): boolean {
		let hasChanged = false;
		if (this.size !== stats.size) {
			this.size = stats.size;
			hasChanged = true;
		}

		if (this.mode !== stats.mode) {
			this.mode = stats.mode;
			hasChanged = true;
		}

		if (this.nlink !== stats.nlink) {
			this.nlink = stats.nlink;
			hasChanged = true;
		}

		if (this.uid !== stats.uid) {
			this.uid = stats.uid;
			hasChanged = true;
		}

		if (this.uid !== stats.uid) {
			this.uid = stats.uid;
			hasChanged = true;
		}

		if (this.atime !== stats.atimeMs) {
			this.atime = stats.atimeMs;
			hasChanged = true;
		}
		if (this.mtime !== stats.mtimeMs) {
			this.mtime = stats.mtimeMs;
			hasChanged = true;
		}

		if (this.ctime !== stats.ctimeMs) {
			this.ctime = stats.ctimeMs;
			hasChanged = true;
		}

		return hasChanged;
	}
}

/**
 * @internal
 */
export const rootIno: Ino = 0n;

/**
 * see https://stackoverflow.com/q/70677751
 *
 * @internal
 */
export function randomIno(): Ino {
	return BigInt(Math.random() * 10 ** 45);
}
