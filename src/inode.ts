import { Stats, type StatsLike } from './stats.js';

/**
 * Alias for an ino.
 * This will be helpful if in the future inode numbers/IDs are changed to strings or numbers.
 */
export type Ino = bigint;

/**
 * Max 32-bit integer
 * @hidden
 */
export const size_max = 2 ** 32 - 1;

/**
 * Room inode
 * @hidden
 */
export const rootIno = 0n as const;

/**
 * Generates a random 32 bit integer, then converts to a hex string
 */
function _random() {
	return Math.round(Math.random() * 2 ** 32).toString(16);
}

/**
 * Generate a random ino
 * @internal
 */
export function randomIno(): Ino {
	return BigInt('0x' + _random() + _random());
}

/**
 * Offsets for inode members
 */
enum Offset {
	ino = 0,
	size = 8, // offsets with a 64-bit size
	mode = 12, // 16
	nlink = 14, // 18
	uid = 18, // 22
	gid = 22, // 26
	atime = 26, // 30
	birthtime = 34, // 38
	mtime = 42, // 46
	ctime = 50, // 54
	end = 58, // 62
}

/**
 * Generic inode definition that can easily be serialized.
 */
export class Inode implements StatsLike {
	public readonly buffer: ArrayBufferLike;

	public get data(): Uint8Array {
		return new Uint8Array(this.buffer);
	}

	protected view: DataView;

	constructor(buffer?: ArrayBufferLike) {
		const setDefaults = !buffer;
		buffer ??= new ArrayBuffer(Offset.end);
		if (buffer?.byteLength < Offset.end) {
			throw new RangeError(`Can not create an inode from a buffer less than ${Offset.end} bytes`);
		}
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
		this.atimeMs = now;
		this.mtimeMs = now;
		this.ctimeMs = now;
		this.birthtimeMs = now;
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

	public get atimeMs(): number {
		return this.view.getFloat64(Offset.atime, true);
	}

	public set atimeMs(value: number) {
		this.view.setFloat64(Offset.atime, value, true);
	}

	public get birthtimeMs(): number {
		return this.view.getFloat64(Offset.birthtime, true);
	}

	public set birthtimeMs(value: number) {
		this.view.setFloat64(Offset.birthtime, value, true);
	}

	public get mtimeMs(): number {
		return this.view.getFloat64(Offset.mtime, true);
	}

	public set mtimeMs(value: number) {
		this.view.setFloat64(Offset.mtime, value, true);
	}

	public get ctimeMs(): number {
		return this.view.getFloat64(Offset.ctime, true);
	}

	public set ctimeMs(value: number) {
		this.view.setFloat64(Offset.ctime, value, true);
	}

	/**
	 * Handy function that converts the Inode to a Node Stats object.
	 */
	public toStats(): Stats {
		return new Stats(this);
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

		if (this.atimeMs !== stats.atimeMs) {
			this.atimeMs = stats.atimeMs;
			hasChanged = true;
		}
		if (this.mtimeMs !== stats.mtimeMs) {
			this.mtimeMs = stats.mtimeMs;
			hasChanged = true;
		}

		if (this.ctimeMs !== stats.ctimeMs) {
			this.ctimeMs = stats.ctimeMs;
			hasChanged = true;
		}

		return hasChanged;
	}
}
