import type * as Node from 'node:fs';
import { credentials } from './credentials.js';
import {
	R_OK,
	S_IFBLK,
	S_IFCHR,
	S_IFDIR,
	S_IFIFO,
	S_IFLNK,
	S_IFMT,
	S_IFREG,
	S_IFSOCK,
	S_IRGRP,
	S_IROTH,
	S_IRUSR,
	S_IWGRP,
	S_IWOTH,
	S_IWUSR,
	S_IXGRP,
	S_IXOTH,
	S_IXUSR,
	size_max,
	W_OK,
	X_OK,
} from './emulation/constants.js';

/**
 * Indicates the type of a file. Applied to 'mode'.
 */
export type FileType = typeof S_IFREG | typeof S_IFDIR | typeof S_IFLNK;

export interface StatsLike<T extends number | bigint = number | bigint> {
	/**
	 * Size of the item in bytes.
	 * For directories/symlinks, this is normally the size of the struct that represents the item.
	 */
	size: T;
	/**
	 * Unix-style file mode (e.g. 0o644) that includes the item type
	 */
	mode: T;
	/**
	 * Time of last access, since epoch
	 */
	atimeMs: T;
	/**
	 * Time of last modification, since epoch
	 */
	mtimeMs: T;
	/**
	 * Time of last time file status was changed, since epoch
	 */
	ctimeMs: T;
	/**
	 * Time of file creation, since epoch
	 */
	birthtimeMs: T;
	/**
	 * The id of the user that owns the file
	 */
	uid: T;
	/**
	 * The id of the group that owns the file
	 */
	gid: T;
	/**
	 * Inode number
	 */
	ino: T;
	/**
	 * Number of hard links
	 */
	nlink: T;
}

/**
 * Provides information about a particular entry in the file system.
 * Common code used by both Stats and BigIntStats.
 */
export abstract class StatsCommon<T extends number | bigint> implements Node.StatsBase<T>, StatsLike {
	protected abstract _isBigint: T extends bigint ? true : false;

	protected _convert(arg: number | bigint | string | boolean): T {
		return (this._isBigint ? BigInt(arg) : Number(arg)) as T;
	}

	public get blocks(): T {
		return this._convert(Math.ceil(Number(this.size) / 512));
	}

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
	 * Inode number
	 */
	public ino: T = this._convert(0);

	/**
	 * Device ID (if special file)
	 */
	public rdev: T = this._convert(0);

	/**
	 * Number of hard links
	 */
	public nlink: T = this._convert(1);

	/**
	 * Block size for file system I/O
	 */
	public blksize: T = this._convert(4096);

	/**
	 * User ID of owner
	 */
	public uid: T = this._convert(0);

	/**
	 * Group ID of owner
	 */
	public gid: T = this._convert(0);

	/**
	 * Some file systems stash data on stats objects.
	 */
	public fileData?: Uint8Array;

	/**
	 * Time of last access, since epoch
	 */
	public atimeMs: T;

	public get atime(): Date {
		return new Date(Number(this.atimeMs));
	}

	public set atime(value: Date) {
		this.atimeMs = this._convert(value.getTime());
	}

	/**
	 * Time of last modification, since epoch
	 */
	public mtimeMs: T;

	public get mtime(): Date {
		return new Date(Number(this.mtimeMs));
	}

	public set mtime(value: Date) {
		this.mtimeMs = this._convert(value.getTime());
	}

	/**
	 * Time of last time file status was changed, since epoch
	 */
	public ctimeMs: T;

	public get ctime(): Date {
		return new Date(Number(this.ctimeMs));
	}

	public set ctime(value: Date) {
		this.ctimeMs = this._convert(value.getTime());
	}

	/**
	 * Time of file creation, since epoch
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
	public constructor({ atimeMs, mtimeMs, ctimeMs, birthtimeMs, uid, gid, size, mode, ino }: Partial<StatsLike> = {}) {
		const now = Date.now();
		this.atimeMs = this._convert(atimeMs ?? now);
		this.mtimeMs = this._convert(mtimeMs ?? now);
		this.ctimeMs = this._convert(ctimeMs ?? now);
		this.birthtimeMs = this._convert(birthtimeMs ?? now);
		this.uid = this._convert(uid ?? 0);
		this.gid = this._convert(gid ?? 0);
		this.size = this._convert(size ?? 0);
		this.ino = this._convert(ino ?? 0);
		this.mode = this._convert(mode ?? 0o644 & S_IFREG);

		if ((this.mode & S_IFMT) == 0) {
			this.mode = (this.mode | this._convert(S_IFREG)) as T;
		}
	}

	public isFile(): boolean {
		return (this.mode & S_IFMT) === S_IFREG;
	}

	public isDirectory(): boolean {
		return (this.mode & S_IFMT) === S_IFDIR;
	}

	public isSymbolicLink(): boolean {
		return (this.mode & S_IFMT) === S_IFLNK;
	}

	public isSocket(): boolean {
		return (this.mode & S_IFMT) === S_IFSOCK;
	}

	public isBlockDevice(): boolean {
		return (this.mode & S_IFMT) === S_IFBLK;
	}

	public isCharacterDevice(): boolean {
		return (this.mode & S_IFMT) === S_IFCHR;
	}

	public isFIFO(): boolean {
		return (this.mode & S_IFMT) === S_IFIFO;
	}

	/**
	 * Checks if a given user/group has access to this item
	 * @param mode The requested access, combination of W_OK, R_OK, and X_OK
	 * @returns True if the request has access, false if the request does not
	 * @internal
	 */
	public hasAccess(mode: number): boolean {
		if (this.isSymbolicLink() || credentials.euid === 0 || credentials.egid === 0) return true;

		let perm = 0;

		// Owner permissions
		if (credentials.uid === this.uid) {
			if (this.mode & S_IRUSR) perm |= R_OK;
			if (this.mode & S_IWUSR) perm |= W_OK;
			if (this.mode & S_IXUSR) perm |= X_OK;
		}

		// Group permissions
		if (credentials.gid === this.gid || credentials.groups.includes(Number(this.gid))) {
			if (this.mode & S_IRGRP) perm |= R_OK;
			if (this.mode & S_IWGRP) perm |= W_OK;
			if (this.mode & S_IXGRP) perm |= X_OK;
		}

		// Others permissions
		if (this.mode & S_IROTH) perm |= R_OK;
		if (this.mode & S_IWOTH) perm |= W_OK;
		if (this.mode & S_IXOTH) perm |= X_OK;

		// Perform the access check
		return (perm & mode) === mode;
	}

	/**
	 * Change the mode of the file.
	 * We use this helper function to prevent messing up the type of the file.
	 * @internal
	 * @deprecated This will be removed in the next minor release since it is internal
	 */
	public chmod(mode: number): void {
		this.mode = this._convert((this.mode & S_IFMT) | mode);
	}

	/**
	 * Change the owner user/group of the file.
	 * This function makes sure it is a valid UID/GID (that is, a 32 unsigned int)
	 * @internal
	 * @deprecated This will be removed in the next minor release since it is internal
	 */
	public chown(uid: number, gid: number): void {
		uid = Number(uid);
		gid = Number(gid);
		if (!isNaN(uid) && 0 <= uid && uid < 2 ** 32) {
			this.uid = this._convert(uid);
		}
		if (!isNaN(gid) && 0 <= gid && gid < 2 ** 32) {
			this.gid = this._convert(gid);
		}
	}

	public get atimeNs(): bigint {
		return BigInt(this.atimeMs) * 1000n;
	}

	public get mtimeNs(): bigint {
		return BigInt(this.mtimeMs) * 1000n;
	}

	public get ctimeNs(): bigint {
		return BigInt(this.ctimeMs) * 1000n;
	}

	public get birthtimeNs(): bigint {
		return BigInt(this.birthtimeMs) * 1000n;
	}
}

/**
 * @hidden @internal
 */
export function _chown(stats: Partial<StatsLike<number>>, uid: number, gid: number) {
	if (!isNaN(uid) && 0 <= uid && uid < 2 ** 32) {
		stats.uid = uid;
	}
	if (!isNaN(gid) && 0 <= gid && gid < 2 ** 32) {
		stats.gid = gid;
	}
}

/**
 * Implementation of Node's `Stats`.
 *
 * Attribute descriptions are from `man 2 stat'
 * @see http://nodejs.org/api/fs.html#fs_class_fs_stats
 * @see http://man7.org/linux/man-pages/man2/stat.2.html
 */
export class Stats extends StatsCommon<number> implements Node.Stats, StatsLike {
	protected _isBigint = false as const;
}
Stats satisfies typeof Node.Stats;

/**
 * Stats with bigint
 */
export class BigIntStats extends StatsCommon<bigint> implements Node.BigIntStats, StatsLike {
	protected _isBigint = true as const;
}

/**
 * Determines if the file stats have changed by comparing relevant properties.
 *
 * @param left The previous stats.
 * @param right The current stats.
 * @returns `true` if stats have changed; otherwise, `false`.
 * @internal
 */
export function isStatsEqual<T extends number | bigint>(left: StatsCommon<T>, right: StatsCommon<T>): boolean {
	return left.size == right.size && +left.atime == +right.atime && +left.mtime == +right.mtime && +left.ctime == +right.ctime && left.mode == right.mode;
}

/** @internal */
export const ZenFsType = 0x7a656e6673; // 'z' 'e' 'n' 'f' 's'

/**
 * @hidden
 */
export class StatsFs implements Node.StatsFsBase<number> {
	/** Type of file system. */
	public type: number = 0x7a656e6673;
	/**  Optimal transfer block size. */
	public bsize: number = 4096;
	/**  Total data blocks in file system. */
	public blocks: number = 0;
	/** Free blocks in file system. */
	public bfree: number = 0;
	/** Available blocks for unprivileged users */
	public bavail: number = 0;
	/** Total file nodes in file system. */
	public files: number = size_max;
	/** Free file nodes in file system. */
	public ffree: number = size_max;
}

/**
 * @hidden
 */
export class BigIntStatsFs implements Node.StatsFsBase<bigint> {
	/** Type of file system. */
	public type: bigint = 0x7a656e6673n;
	/**  Optimal transfer block size. */
	public bsize: bigint = 4096n;
	/**  Total data blocks in file system. */
	public blocks: bigint = 0n;
	/** Free blocks in file system. */
	public bfree: bigint = 0n;
	/** Available blocks for unprivileged users */
	public bavail: bigint = 0n;
	/** Total file nodes in file system. */
	public files: bigint = BigInt(size_max);
	/** Free file nodes in file system. */
	public ffree: bigint = BigInt(size_max);
}
