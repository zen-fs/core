import type * as Node from 'node:fs';
import { pick } from 'utilium';
import type { V_Context } from '../context.js';
import { credentials } from '../internal/credentials.js';
import type { InodeFields, InodeLike } from '../internal/inode.js';
import { _inode_fields } from '../internal/inode.js';
import * as c from './constants.js';

const n1000 = BigInt(1000) as 1000n;

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

	public set blocks(value: T) {}

	/**
	 * Unix-style file mode (e.g. 0o644) that includes the type of the item.
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

	public data?: number;
	public flags?: number;

	/**
	 * Creates a new stats instance from a stats-like object. Can be used to copy stats (note)
	 */
	public constructor({ atimeMs, mtimeMs, ctimeMs, birthtimeMs, uid, gid, size, mode, ino, ...rest }: Partial<InodeLike> = {}) {
		const now = Date.now();
		this.atimeMs = this._convert(atimeMs ?? now);
		this.mtimeMs = this._convert(mtimeMs ?? now);
		this.ctimeMs = this._convert(ctimeMs ?? now);
		this.birthtimeMs = this._convert(birthtimeMs ?? now);
		this.uid = this._convert(uid ?? 0);
		this.gid = this._convert(gid ?? 0);
		this.size = this._convert(size ?? 0);
		this.ino = this._convert(ino ?? 0);
		this.mode = this._convert(mode ?? 0o644 & c.S_IFREG);

		if ((this.mode & c.S_IFMT) == 0) {
			this.mode = (this.mode | this._convert(c.S_IFREG)) as T;
		}
		Object.assign(this, rest);
	}

	public isFile(): boolean {
		return (this.mode & c.S_IFMT) === c.S_IFREG;
	}

	public isDirectory(): boolean {
		return (this.mode & c.S_IFMT) === c.S_IFDIR;
	}

	public isSymbolicLink(): boolean {
		return (this.mode & c.S_IFMT) === c.S_IFLNK;
	}

	public isSocket(): boolean {
		return (this.mode & c.S_IFMT) === c.S_IFSOCK;
	}

	public isBlockDevice(): boolean {
		return (this.mode & c.S_IFMT) === c.S_IFBLK;
	}

	public isCharacterDevice(): boolean {
		return (this.mode & c.S_IFMT) === c.S_IFCHR;
	}

	public isFIFO(): boolean {
		return (this.mode & c.S_IFMT) === c.S_IFIFO;
	}

	public toJSON(): StatsLike<T> & InodeFields {
		return pick(this, _inode_fields);
	}

	/**
	 * Checks if a given user/group has access to this item
	 * @param mode The requested access, combination of W_OK, R_OK, and X_OK
	 * @returns True if the request has access, false if the request does not
	 * @internal
	 */
	public hasAccess(mode: number, context?: V_Context): boolean {
		const creds = context?.credentials || credentials;

		if (this.isSymbolicLink() || creds.euid === 0 || creds.egid === 0) return true;

		let perm = 0;

		// Owner permissions
		if (creds.uid === this.uid) {
			if (this.mode & c.S_IRUSR) perm |= c.R_OK;
			if (this.mode & c.S_IWUSR) perm |= c.W_OK;
			if (this.mode & c.S_IXUSR) perm |= c.X_OK;
		}

		// Group permissions
		if (creds.gid === this.gid || creds.groups.includes(Number(this.gid))) {
			if (this.mode & c.S_IRGRP) perm |= c.R_OK;
			if (this.mode & c.S_IWGRP) perm |= c.W_OK;
			if (this.mode & c.S_IXGRP) perm |= c.X_OK;
		}

		// Others permissions
		if (this.mode & c.S_IROTH) perm |= c.R_OK;
		if (this.mode & c.S_IWOTH) perm |= c.W_OK;
		if (this.mode & c.S_IXOTH) perm |= c.X_OK;

		// Perform the access check
		return (perm & mode) === mode;
	}

	public get atimeNs(): bigint {
		return BigInt(this.atimeMs) * n1000;
	}

	public get mtimeNs(): bigint {
		return BigInt(this.mtimeMs) * n1000;
	}

	public get ctimeNs(): bigint {
		return BigInt(this.ctimeMs) * n1000;
	}

	public get birthtimeNs(): bigint {
		return BigInt(this.birthtimeMs) * n1000;
	}
}

/**
 * @hidden @internal
 */
export function _chown(stats: Partial<StatsLike<number>>, uid: number, gid: number) {
	if (!isNaN(uid) && 0 <= uid && uid < c.size_max) {
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
	return (
		left.size == right.size
		&& +left.atime == +right.atime
		&& +left.mtime == +right.mtime
		&& +left.ctime == +right.ctime
		&& left.mode == right.mode
	);
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
	public files: number = c.size_max;
	/** Free file nodes in file system. */
	public ffree: number = c.size_max;
}

/**
 * @hidden
 */
export class BigIntStatsFs implements Node.StatsFsBase<bigint> {
	/** Type of file system. */
	public type: bigint = BigInt('0x7a656e6673');
	/**  Optimal transfer block size. */
	public bsize: bigint = BigInt(4096);
	/**  Total data blocks in file system. */
	public blocks: bigint = BigInt(0);
	/** Free blocks in file system. */
	public bfree: bigint = BigInt(0);
	/** Available blocks for unprivileged users */
	public bavail: bigint = BigInt(0);
	/** Total file nodes in file system. */
	public files: bigint = BigInt(c.size_max);
	/** Free file nodes in file system. */
	public ffree: bigint = BigInt(c.size_max);
}
