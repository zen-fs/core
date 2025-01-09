import { deserialize, pick, randomInt, sizeof, struct, types as t } from 'utilium';
import { Stats, type StatsLike } from '../../stats.js';
import { size_max } from '../../vfs/constants.js';

/**
 * Root inode
 * @hidden
 */
export const rootIno = 0;

export interface InodeLike extends StatsLike<number> {
	data?: number;
	flags?: number;
}

/**
 * Generic inode definition that can easily be serialized.
 * @internal
 * @todo [BREAKING] Remove 58 byte Inode upgrade path
 */
@struct()
export class Inode implements InodeLike {
	public constructor(data?: ArrayBufferLike | ArrayBufferView | InodeLike) {
		if (!data) return;

		if (!('byteLength' in data)) {
			Object.assign(this, data);
			return;
		}

		if (data.byteLength < 58) {
			throw new RangeError('Can not create an inode from a buffer less than 58 bytes');
		}

		// Expand the buffer so it is the right size
		if (data.byteLength < sz_inode) {
			const buf = ArrayBuffer.isView(data) ? data.buffer : data;
			const newBuffer = new Uint8Array(sz_inode);
			newBuffer.set(new Uint8Array(buf));
			data = newBuffer;
		}

		deserialize(this, data);
	}

	@t.uint32 public data: number = randomInt(0, size_max);
	/** For future use */
	@t.uint32 public __data_old: number = 0;
	@t.uint32 public size: number = 4096;
	@t.uint16 public mode: number = 0;
	@t.uint32 public nlink: number = 1;
	@t.uint32 public uid: number = 0;
	@t.uint32 public gid: number = 0;
	@t.float64 public atimeMs: number = Date.now();
	@t.float64 public birthtimeMs: number = Date.now();
	@t.float64 public mtimeMs: number = Date.now();
	@t.float64 public ctimeMs: number = Date.now();
	@t.uint32 public ino: number = randomInt(0, size_max);
	/** For future use */
	@t.uint32 public __ino_old: number = 0;
	@t.uint32 public flags: number = 0;
	/** For future use */
	@t.uint16 public __padding: number = 0;

	public toJSON(): InodeLike {
		return pick(this, 'ino', 'data', 'size', 'mode', 'flags', 'nlink', 'uid', 'gid', 'atimeMs', 'birthtimeMs', 'mtimeMs', 'ctimeMs');
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
	 * @returns whether any changes have occurred.
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

		if (this.gid !== stats.gid) {
			this.gid = stats.gid;
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

const sz_inode = sizeof(Inode);
