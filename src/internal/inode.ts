import { deserialize, pick, randomInt, sizeof, struct, types as t } from 'utilium';
import { Stats, type StatsLike } from '../stats.js';
import { size_max } from '../vfs/constants.js';
import { crit, debug } from './log.js';

/**
 * Root inode
 * @hidden
 */
export const rootIno = 0;

/**
 * @internal @hidden
 */
export interface InodeFields {
	data?: number;
	flags?: number;
}

/**
 * @category Internals
 * @internal
 */
export interface InodeLike extends StatsLike<number>, InodeFields {}

/**
 * @internal @hidden
 */
export const _inode_fields = ['ino', 'data', 'size', 'mode', 'flags', 'nlink', 'uid', 'gid', 'atimeMs', 'birthtimeMs', 'mtimeMs', 'ctimeMs'] as const;

/**
 * Generic inode definition that can easily be serialized.
 * @category Internals
 * @internal
 * @todo [BREAKING] Remove 58 byte Inode upgrade path
 */
@struct()
export class Inode implements InodeLike {
	public constructor(data?: ArrayBufferLike | ArrayBufferView | Readonly<Partial<InodeLike>>) {
		if (!data) return;

		if (!('byteLength' in data)) {
			Object.assign(this, data);
			return;
		}

		if (data.byteLength < 58) {
			throw crit(new RangeError('Can not create an inode from a buffer less than 58 bytes'));
		}

		// Expand the buffer so it is the right size
		if (data.byteLength < __inode_sz) {
			const buf = ArrayBuffer.isView(data) ? data.buffer : data;
			const newBuffer = new Uint8Array(__inode_sz);
			newBuffer.set(new Uint8Array(buf));
			debug('Extending undersized buffer for inode');
			data = newBuffer;
		}

		deserialize(this, data);
	}

	@t.uint32 public data: number = randomInt(0, size_max);
	/** For future use */
	@t.uint32 public __data_old: number = 0;
	@t.uint32 public size: number = 0;
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

	public toString(): string {
		return `<Inode ${this.ino}>`;
	}

	public toJSON(): InodeLike {
		return pick(this, _inode_fields);
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
	public update(data?: Partial<Readonly<InodeLike>>): boolean {
		if (!data) return false;

		let hasChanged = false;

		for (const key of _inode_fields) {
			if (data[key] === undefined) continue;

			// When multiple StoreFSes are used in a single stack, the differing IDs end up here.
			if (key == 'ino' || key == 'data') continue;

			if (this[key] === data[key]) continue;

			this[key] = data[key];
			hasChanged = true;
		}

		return hasChanged;
	}
}

/**
 * @internal @hidden
 */
export const __inode_sz = sizeof(Inode);
