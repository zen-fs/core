import { Stats, type StatsLike } from './stats.js';
import { types as t, struct, sizeof, serialize, deserialize } from 'utilium';

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
export const rootIno = 0n;

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
 * Generic inode definition that can easily be serialized.
 */
@struct()
export class Inode implements StatsLike {
	public get data(): Uint8Array {
		return serialize(this);
	}

	public constructor(buffer?: ArrayBufferLike) {
		if (buffer) {
			if (buffer.byteLength < sizeof(Inode)) {
				throw new RangeError(`Can not create an inode from a buffer less than ${sizeof(Inode)} bytes`);
			}

			deserialize(this, buffer);
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

	@t.uint64 public ino!: Ino;
	@t.uint32 public size!: number;
	@t.uint16 public mode!: number;
	@t.uint32 public nlink!: number;
	@t.uint32 public uid!: number;
	@t.uint32 public gid!: number;
	@t.float64 public atimeMs!: number;
	@t.float64 public birthtimeMs!: number;
	@t.float64 public mtimeMs!: number;
	@t.float64 public ctimeMs!: number;

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
