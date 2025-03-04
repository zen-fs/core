import { deserialize, pick, randomInt, serialize, sizeof, struct, types as t } from 'utilium';
import { decodeUTF8, encodeUTF8 } from '../utils.js';
import * as c from '../vfs/constants.js';
import { size_max } from '../vfs/constants.js';
import { Stats, type StatsLike } from '../vfs/stats.js';
import { Errno, ErrnoError } from './error.js';
import { crit, debug, err, warn } from './log.js';

/**
 * Root inode
 * @hidden
 */
export const rootIno = 0;

export type Attributes = Record<string, string>;

/**
 * @internal @hidden
 */
export interface InodeFields {
	data?: number;
	flags?: number;
	attributes?: Attributes;
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
 * Represents which version of the `Inode` format we are on.
 * 1. 58 bytes. The first member was called `ino` but used as the ID for data.
 * 2. 66 bytes. Renamed the first member from `ino` to `data` and added a separate `ino` field
 * 3. 72 bytes. Changed the ID fields from 64 to 32 bits and added `flags`.
 * 4. (current) Added extended attributes. At least 128 bytes.
 * @internal @hidden
 */
export const _inode_version = 4;

/**
 * Generic inode definition that can easily be serialized.
 * @category Internals
 * @internal
 */
@struct()
export class Inode implements InodeLike {
	public constructor(data?: Uint8Array | Readonly<Partial<InodeLike>>) {
		if (!data) return;

		if (!('byteLength' in data)) {
			Object.assign(this, data);
			return;
		}

		if (data.byteLength < sizeof(Inode)) throw crit(new ErrnoError(Errno.EIO, 'Buffer is too small to create an inode'));

		deserialize(this, data);
		const rawAttr = data.subarray(sizeof(Inode));
		if (rawAttr.length < 2) warn('Attributes is empty');
		else if (rawAttr.length != this.attributes_size) err(new ErrnoError(Errno.EIO, 'Attributes size mismatch with actual size'));
		else this.attributes = JSON.parse(decodeUTF8(rawAttr));
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
	@t.uint16 protected __after_flags: number = 0;

	@t.uint32 public attributes_size: number = 2;

	/** Pad to 128 bytes */
	@t.uint8(52) protected __padding = [];

	public attributes: Attributes = {};

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

		if (data.attributes && JSON.stringify(this.attributes) !== JSON.stringify(data.attributes)) {
			this.attributes = data.attributes;
			this.attributes_size = encodeUTF8(JSON.stringify(this.attributes)).byteLength;
			hasChanged = true;
		}

		return hasChanged;
	}

	public serialize(): Uint8Array {
		const data = serialize(this);
		const attr = encodeUTF8(JSON.stringify(this.attributes));
		const buf = new Uint8Array(data.byteLength + attr.byteLength);
		buf.set(data);
		buf.set(attr, data.byteLength);
		return buf;
	}
}

export function isFile(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFREG;
}

export function isDirectory(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFDIR;
}

export function isSymbolicLink(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFLNK;
}

export function isSocket(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFSOCK;
}

export function isBlockDevice(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFBLK;
}

export function isCharacterDevice(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFCHR;
}

export function isFIFO(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFIFO;
}
