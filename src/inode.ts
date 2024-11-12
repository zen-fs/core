import { deserialize, sizeof, struct, types as t } from 'utilium';
import { Stats, type StatsLike } from './stats.js';
import { randomBigInt } from './utils.js';

/**
 * Room inode
 * @hidden
 */
export const rootIno = 0n;

/**
 * Generic inode definition that can easily be serialized.
 * @internal
 */
@struct()
export class Inode implements StatsLike {
	public constructor(buffer?: ArrayBufferLike | ArrayBufferView) {
		if (buffer) {
			if (buffer.byteLength < sizeof(Inode)) {
				throw new RangeError(`Can not create an inode from a buffer less than ${sizeof(Inode)} bytes`);
			}

			deserialize(this, buffer);
			return;
		}

		// set defaults on a fresh inode
		this.ino = randomBigInt();
		this.data = randomBigInt();
		this.nlink = 1;
		this.size = 4096;
		const now = Date.now();
		this.atimeMs = now;
		this.mtimeMs = now;
		this.ctimeMs = now;
		this.birthtimeMs = now;
	}

	@t.uint64 public data!: bigint;
	@t.uint32 public size!: number;
	@t.uint16 public mode!: number;
	@t.uint32 public nlink!: number;
	@t.uint32 public uid!: number;
	@t.uint32 public gid!: number;
	@t.float64 public atimeMs!: number;
	@t.float64 public birthtimeMs!: number;
	@t.float64 public mtimeMs!: number;
	@t.float64 public ctimeMs!: number;
	@t.uint64 public ino!: bigint;

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
