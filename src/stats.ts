import type { StatsBase, Stats as _Stats, BigIntStats as _BigIntStats } from 'fs';
import { Cred } from './cred.js';

import { S_IFDIR, S_IFLNK, S_IFMT, S_IFREG } from './emulation/constants.js';

/**
 * Indicates the type of the given file. Applied to 'mode'.
 */
export enum FileType {
	FILE = S_IFREG,
	DIRECTORY = S_IFDIR,
	SYMLINK = S_IFLNK,
}

/**
 * Common code used by both Stats and BigIntStats
 */
export abstract class StatsCommon<T extends number | bigint> implements StatsBase<T> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public static Deserialize(data: ArrayBufferLike | ArrayBufferView): StatsCommon<number> | StatsCommon<bigint> {
		throw new ReferenceError('Called static abstract method: StatsCommon.Deserialize()');
	}

	protected abstract _isBigint: boolean;

	protected get _typename(): string {
		return this._isBigint ? 'bigint' : 'number';
	}

	protected get _typename_inverse(): string {
		return this._isBigint ? 'number' : 'bigint';
	}

	protected _convert(arg: number | bigint | string | boolean): T {
		return (this._isBigint ? BigInt(arg) : Number(arg)) as T;
	}

	public blocks: T;
	public mode: T;

	/**
	 * ID of device containing file
	 */
	public dev: T = this._convert(0);
	/**
	 * inode number
	 */
	public ino: T = this._convert(0);
	/**
	 * device ID (if special file)
	 */
	public rdev: T = this._convert(0);
	/**
	 * number of hard links
	 */
	public nlink: T = this._convert(1);
	/**
	 * blocksize for file system I/O
	 */
	public blksize: T = this._convert(4096);
	/**
	 * user ID of owner
	 */
	public uid: T = this._convert(0);
	/**
	 * group ID of owner
	 */
	public gid: T = this._convert(0);
	/**
	 * Some file systems stash data on stats objects.
	 */
	public fileData: Uint8Array | null = null;
	public atimeMs: T;
	public mtimeMs: T;
	public ctimeMs: T;
	public birthtimeMs: T;
	public size: T;

	public get atime(): Date {
		return new Date(Number(this.atimeMs));
	}

	public get mtime(): Date {
		return new Date(Number(this.mtimeMs));
	}

	public get ctime(): Date {
		return new Date(Number(this.ctimeMs));
	}

	public get birthtime(): Date {
		return new Date(Number(this.birthtimeMs));
	}

	/**
	 * Provides information about a particular entry in the file system.
	 * @param itemType Type of the item (FILE, DIRECTORY, SYMLINK, or SOCKET)
	 * @param size Size of the item in bytes. For directories/symlinks,
	 *   this is normally the size of the struct that represents the item.
	 * @param mode Unix-style file mode (e.g. 0o644)
	 * @param atimeMs time of last access, in milliseconds since epoch
	 * @param mtimeMs time of last modification, in milliseconds since epoch
	 * @param ctimeMs time of last time file status was changed, in milliseconds since epoch
	 * @param uid the id of the user that owns the file
	 * @param gid the id of the group that owns the file
	 * @param birthtimeMs time of file creation, in milliseconds since epoch
	 */
	constructor(
		itemType: FileType = FileType.FILE,
		size: number | bigint = -1,
		mode?: number | bigint,
		atimeMs?: number | bigint,
		mtimeMs?: number | bigint,
		ctimeMs?: number | bigint,
		uid?: number | bigint,
		gid?: number | bigint,
		birthtimeMs?: number | bigint
	) {
		const currentTime = Date.now();
		const resolveT = (v: number | bigint, def: number) => (typeof v == this._typename ? v : this._convert(typeof v == this._typename_inverse ? v : def)) as T;
		this.atimeMs = resolveT(atimeMs, currentTime);
		this.mtimeMs = resolveT(mtimeMs, currentTime);
		this.ctimeMs = resolveT(ctimeMs, currentTime);
		this.birthtimeMs = resolveT(birthtimeMs, currentTime);
		this.uid = resolveT(uid, 0);
		this.gid = resolveT(gid, 0);
		this.size = this._convert(size);

		if (mode) {
			this.mode = this._convert(mode);
		} else {
			switch (itemType) {
				case FileType.FILE:
					this.mode = this._convert(0o644);
					break;
				case FileType.DIRECTORY:
				default:
					this.mode = this._convert(0o777);
			}
		}
		// number of 512B blocks allocated
		this.blocks = this._convert(Math.ceil(Number(size) / 512));
		// Check if mode also includes top-most bits, which indicate the file's
		// type.
		if ((this.mode & S_IFMT) == 0) {
			this.mode = (this.mode | this._convert(itemType)) as T;
		}
	}

	public abstract serialize(): Uint8Array;

	/**
	 * @return [Boolean] True if this item is a file.
	 */
	public isFile(): boolean {
		return (this.mode & S_IFMT) === S_IFREG;
	}

	/**
	 * @return [Boolean] True if this item is a directory.
	 */
	public isDirectory(): boolean {
		return (this.mode & S_IFMT) === S_IFDIR;
	}

	/**
	 * @return [Boolean] True if this item is a symbolic link (only valid through lstat)
	 */
	public isSymbolicLink(): boolean {
		return (this.mode & S_IFMT) === S_IFLNK;
	}

	/**
	 * Checks if a given user/group has access to this item
	 * @param mode The request access as 4 bits (unused, read, write, execute)
	 * @param uid The requesting UID
	 * @param gid The requesting GID
	 * @returns [Boolean] True if the request has access, false if the request does not
	 */
	public hasAccess(mode: number, cred: Cred): boolean {
		if (cred.euid === 0 || cred.egid === 0) {
			//Running as root
			return true;
		}
		const perms = this.mode & ~S_IFMT;
		let uMode = 0xf,
			gMode = 0xf,
			wMode = 0xf;

		if (cred.euid == this.uid) {
			const uPerms = (0xf00 & perms) >> 8;
			uMode = (mode ^ uPerms) & mode;
		}
		if (cred.egid == this.gid) {
			const gPerms = (0xf0 & perms) >> 4;
			gMode = (mode ^ gPerms) & mode;
		}
		const wPerms = 0xf & perms;
		wMode = (mode ^ wPerms) & mode;
		/*
        Result = 0b0xxx (read, write, execute)
        If any bits are set that means the request does not have that permission.
    */
		const result = uMode & gMode & wMode;
		return !result;
	}

	/**
	 * Convert the current stats object into a cred object
	 */
	public getCred(uid: number = Number(this.uid), gid: number = Number(this.gid)): Cred {
		return new Cred(uid, gid, Number(this.uid), Number(this.gid), uid, gid);
	}

	/**
	 * Change the mode of the file. We use this helper function to prevent messing
	 * up the type of the file, which is encoded in mode.
	 */
	public chmod(mode: number): void {
		this.mode = this._convert((this.mode & S_IFMT) | mode);
	}

	/**
	 * Change the owner user/group of the file.
	 * This function makes sure it is a valid UID/GID (that is, a 32 unsigned int)
	 */
	public chown(uid: number | bigint, gid: number | bigint): void {
		uid = Number(uid);
		gid = Number(gid);
		if (!isNaN(uid) && 0 <= uid && uid < 2 ** 32) {
			this.uid = this._convert(uid);
		}
		if (!isNaN(gid) && 0 <= gid && gid < 2 ** 32) {
			this.gid = this._convert(gid);
		}
	}

	// We don't support the following types of files.

	public isSocket(): boolean {
		return false;
	}

	public isBlockDevice(): boolean {
		return false;
	}

	public isCharacterDevice(): boolean {
		return false;
	}

	public isFIFO(): boolean {
		return false;
	}
}

/**
 * Implementation of Node's `Stats`.
 *
 * Attribute descriptions are from `man 2 stat'
 * @see http://nodejs.org/api/fs.html#fs_class_fs_stats
 * @see http://man7.org/linux/man-pages/man2/stat.2.html
 */
export class Stats extends StatsCommon<number> {
	protected _isBigint = false;

	/**
	 * Clones the stats object.
	 */
	public static clone(s: Stats): Stats {
		return new Stats(s.mode & S_IFMT, s.size, s.mode & ~S_IFMT, s.atimeMs, s.mtimeMs, s.ctimeMs, s.uid, s.gid, s.birthtimeMs);
	}

	public static Deserialize(data: ArrayBufferLike | ArrayBufferView): Stats {
		const view = new DataView('buffer' in data ? data.buffer : data);
		const size = view.getUint32(0, true),
			mode = view.getUint32(4, true),
			atime = view.getFloat64(8, true),
			mtime = view.getFloat64(16, true),
			ctime = view.getFloat64(24, true),
			uid = view.getUint32(32, true),
			gid = view.getUint32(36, true);

		return new Stats(mode & S_IFMT, size, mode & ~S_IFMT, atime, mtime, ctime, uid, gid);
	}

	public serialize(): Uint8Array {
		const data = new Uint8Array(32),
			view = new DataView(data.buffer);
		view.setUint32(0, this.size, true);
		view.setUint32(4, this.mode, true);
		view.setFloat64(8, this.atime.getTime(), true);
		view.setFloat64(16, this.mtime.getTime(), true);
		view.setFloat64(24, this.ctime.getTime(), true);
		view.setUint32(32, this.uid, true);
		view.setUint32(36, this.gid, true);
		return data;
	}
}
const $typecheck$Stats: typeof _Stats = Stats; // eslint-disable-line @typescript-eslint/no-unused-vars

/**
 * Stats with bigint
 * @todo Implement with bigint instead of wrapping Stats
 */
export class BigIntStats extends StatsCommon<bigint> implements _BigIntStats {
	protected _isBigint = true;

	public atimeNs: bigint;
	public mtimeNs: bigint;
	public ctimeNs: bigint;
	public birthtimeNs: bigint;

	/**
	 * Clone a stats object.
	 */
	public static clone(s: BigIntStats | Stats): BigIntStats {
		return new BigIntStats(
			Number(s.mode) & S_IFMT,
			BigInt(s.size),
			BigInt(s.mode) & BigInt(~S_IFMT),
			BigInt(s.atimeMs),
			BigInt(s.mtimeMs),
			BigInt(s.ctimeMs),
			BigInt(s.uid),
			BigInt(s.gid),
			BigInt(s.birthtimeMs)
		);
	}

	public static Deserialize(data: ArrayBufferLike | ArrayBufferView): Stats {
		const view = new DataView('buffer' in data ? data.buffer : data);
		const size = view.getBigUint64(0, true),
			mode = view.getBigUint64(4, true),
			atime = view.getFloat64(8, true),
			mtime = view.getFloat64(16, true),
			ctime = view.getFloat64(24, true),
			uid = view.getBigUint64(32, true),
			gid = view.getBigUint64(36, true);

		return new Stats(Number(mode) & S_IFMT, size, mode & BigInt(~S_IFMT), atime, mtime, ctime, uid, gid);
	}

	public serialize(): Uint8Array {
		const data = new Uint8Array(32),
			view = new DataView(data.buffer);
		view.setBigUint64(0, this.size, true);
		view.setBigUint64(4, this.mode, true);
		view.setFloat64(8, this.atime.getTime(), true);
		view.setFloat64(16, this.mtime.getTime(), true);
		view.setFloat64(24, this.ctime.getTime(), true);
		view.setBigUint64(32, this.uid, true);
		view.setBigUint64(36, this.gid, true);
		return data;
	}
}
const $typecheck$BigIntStats: typeof _BigIntStats = BigIntStats; // eslint-disable-line @typescript-eslint/no-unused-vars
