import type * as Node from 'fs';
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
 *
 */
export interface StatsLike {
	/**
	 * Size of the item in bytes.
	 * For directories/symlinks, this is normally the size of the struct that represents the item.
	 */
	size: number | bigint;
	/**
	 * Unix-style file mode (e.g. 0o644) that includes the item type
	 * Type of the item can be FILE, DIRECTORY, SYMLINK, or SOCKET
	 */
	mode: number | bigint;
	/**
	 * time of last access, in milliseconds since epoch
	 */
	atimeMs: number | bigint;
	/**
	 * time of last modification, in milliseconds since epoch
	 */
	mtimeMs: number | bigint;
	/**
	 * time of last time file status was changed, in milliseconds since epoch
	 */
	ctimeMs: number | bigint;
	/**
	 * time of file creation, in milliseconds since epoch
	 */
	birthtimeMs: number | bigint;
	/**
	 * the id of the user that owns the file
	 */
	uid: number | bigint;
	/**
	 * the id of the group that owns the file
	 */
	gid: number | bigint;
}

/**
 * Provides information about a particular entry in the file system.
 * Common code used by both Stats and BigIntStats.
 */
export abstract class StatsCommon<T extends number | bigint> implements Node.StatsBase<T> {
	protected abstract _isBigint: boolean;

	protected get _typename(): string {
		return this._isBigint ? 'bigint' : 'number';
	}

	protected get _typename_inverse(): string {
		return this._isBigint ? 'number' : 'bigint';
	}

	protected _convert(arg: number | bigint | string | boolean): T {
		return <T>(this._isBigint ? BigInt(arg) : Number(arg));
	}

	public blocks: T;

	/**
	 * Unix-style file mode (e.g. 0o644) that includes the type of the item.
	 * Type of the item can be FILE, DIRECTORY, SYMLINK, or SOCKET
	 */
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
	public fileData?: Uint8Array = null;

	/**
	 * time of last access, in milliseconds since epoch
	 */
	public atimeMs: T;

	public get atime(): Date {
		return new Date(Number(this.atimeMs));
	}

	public set atime(value: Date) {
		this.atimeMs = this._convert(value.getTime());
	}

	/**
	 * time of last modification, in milliseconds since epoch
	 */
	public mtimeMs: T;

	public get mtime(): Date {
		return new Date(Number(this.mtimeMs));
	}

	public set mtime(value: Date) {
		this.mtimeMs = this._convert(value.getTime());
	}

	/**
	 * time of last time file status was changed, in milliseconds since epoch
	 */
	public ctimeMs: T;

	public get ctime(): Date {
		return new Date(Number(this.ctimeMs));
	}

	public set ctime(value: Date) {
		this.ctimeMs = this._convert(value.getTime());
	}

	/**
	 * time of file creation, in milliseconds since epoch
	 */
	public birthtimeMs: T;

	public get birthtime(): Date {
		return new Date(Number(this.birthtimeMs));
	}

	public set birthtime(value: Date) {
		this.birthtimeMs = this._convert(value.getTime());
	}

	/**
	 * Size of the item in bytes.
	 * For directories/symlinks, this is normally the size of the struct that represents the item.
	 */
	public size: T;

	/**
	 * Creates a new stats instance from a stats-like object. Can be used to copy stats (note)
	 */
	constructor({ atimeMs, mtimeMs, ctimeMs, birthtimeMs, uid, gid, size, mode }: Partial<StatsLike> = {}) {
		const currentTime = Date.now();
		const resolveT = (val: number | bigint, _default: number) => <T>(typeof val == this._typename ? val : this._convert(typeof val == this._typename_inverse ? val : _default));
		this.atimeMs = resolveT(atimeMs, currentTime);
		this.mtimeMs = resolveT(mtimeMs, currentTime);
		this.ctimeMs = resolveT(ctimeMs, currentTime);
		this.birthtimeMs = resolveT(birthtimeMs, currentTime);
		this.uid = resolveT(uid, 0);
		this.gid = resolveT(gid, 0);
		this.size = this._convert(size);
		const itemType: FileType = Number(mode) & S_IFMT || FileType.FILE;

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
		// Check if mode also includes top-most bits, which indicate the file's type.
		if ((this.mode & S_IFMT) == 0) {
			this.mode = <T>(this.mode | this._convert(itemType));
		}
	}

	/**
	 * @returns true if this item is a file.
	 */
	public isFile(): boolean {
		return (this.mode & S_IFMT) === S_IFREG;
	}

	/**
	 * @returns True if this item is a directory.
	 */
	public isDirectory(): boolean {
		return (this.mode & S_IFMT) === S_IFDIR;
	}

	/**
	 * @returns true if this item is a symbolic link
	 */
	public isSymbolicLink(): boolean {
		return (this.mode & S_IFMT) === S_IFLNK;
	}

	// Currently unsupported

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

	/**
	 * Checks if a given user/group has access to this item
	 * @param mode The request access as 4 bits (unused, read, write, execute)
	 * @param uid The requesting UID
	 * @param gid The requesting GID
	 * @returns True if the request has access, false if the request does not
	 * @internal
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
	 * @internal
	 */
	public getCred(uid: number = Number(this.uid), gid: number = Number(this.gid)): Cred {
		return new Cred(uid, gid, Number(this.uid), Number(this.gid), uid, gid);
	}

	/**
	 * Change the mode of the file. We use this helper function to prevent messing
	 * up the type of the file, which is encoded in mode.
	 * @internal
	 */
	public chmod(mode: number): void {
		this.mode = this._convert((this.mode & S_IFMT) | mode);
	}

	/**
	 * Change the owner user/group of the file.
	 * This function makes sure it is a valid UID/GID (that is, a 32 unsigned int)
	 * @internal
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
}

/**
 * Implementation of Node's `Stats`.
 *
 * Attribute descriptions are from `man 2 stat'
 * @see http://nodejs.org/api/fs.html#fs_class_fs_stats
 * @see http://man7.org/linux/man-pages/man2/stat.2.html
 */
export class Stats extends StatsCommon<number> implements Node.Stats {
	protected _isBigint = false;

	/**
	 * Clones the stats object.
	 * @deprecated use `new Stats(stats)`
	 */
	public static clone(stats: Stats): Stats {
		return new Stats(stats);
	}
}
Stats satisfies typeof Node.Stats;

/**
 * Stats with bigint
 * @todo Implement with bigint instead of wrapping Stats
 */
export class BigIntStats extends StatsCommon<bigint> implements Node.BigIntStats {
	protected _isBigint = true;

	public atimeNs: bigint;
	public mtimeNs: bigint;
	public ctimeNs: bigint;
	public birthtimeNs: bigint;

	/**
	 * Clone a stats object.
	 * @deprecated use `new BigIntStats(stats)`
	 */
	public static clone(stats: BigIntStats | Stats): BigIntStats {
		return new BigIntStats(stats);
	}
}
BigIntStats satisfies typeof Node.BigIntStats;
