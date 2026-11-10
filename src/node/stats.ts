// SPDX-License-Identifier: LGPL-3.0-or-later
import type * as Node from 'node:fs';
import { omit, pick } from 'utilium';
import * as c from '../constants.js';
import type { V_Context } from '../context.js';
import type { InodeFields, StatsLike } from '../internal/inode.js';
import { _inode_fields, hasAccess } from '../internal/inode.js';
import { temporal } from './utils.js';

const _nsMultiplier = 1_000_000n;

export interface StatsExtra<T extends number | bigint> {
	/** ID of device containing file */
	dev: T;
	/** Block size for file system I/O */
	blksize: T;
}

/**
 * Provides information about a particular entry in the file system.
 * Common code used by both Stats and BigIntStats.
 */
export abstract class StatsCommon<T extends number | bigint> implements Node.StatsBase<T>, StatsLike<T>, StatsExtra<T> {
	/** A getter rather than a field, since fields of subclasses are not yet initialized while the constructor converts values */
	protected abstract get _isBigint(): T extends bigint ? true : false;

	protected _convert(arg: number | bigint | string | boolean): T {
		if (!this._isBigint) return Number(arg) as T;
		return (typeof arg == 'number' ? BigInt(Math.trunc(arg)) : BigInt(arg)) as T;
	}

	public get blocks(): T {
		return this._convert(Math.ceil(Number(this.size) / 512));
	}

	public set blocks(value: T) {}

	/** Unix-style file mode (e.g. 0o644) that includes the type of the item. */
	public mode: T;
	/** ID of device containing file */
	public dev: T = this._convert(0);
	/** Inode number */
	public ino: T = this._convert(0);
	/** Device ID (if special file) */
	public rdev: T = this._convert(0);
	/** Number of hard links */
	public nlink: T = this._convert(1);
	/** Block size for file system I/O */
	public blksize: T = this._convert(4096);
	/** User ID of owner */
	public uid: T = this._convert(0);
	/** Group ID of owner */
	public gid: T = this._convert(0);
	/** Time of last access, since epoch */
	public atimeMs: T;
	declare public atime: Date;

	public get atimeInstant(): Temporal.Instant {
		return temporal().Instant.fromEpochMilliseconds(Number(this.atimeMs));
	}

	public set atimeInstant(value: Temporal.Instant) {
		this.atimeMs = this._convert(value.epochMilliseconds);
	}

	/** Time of last modification, since epoch */
	public mtimeMs: T;
	declare public mtime: Date;
	public get mtimeInstant(): Temporal.Instant {
		return temporal().Instant.fromEpochMilliseconds(Number(this.mtimeMs));
	}
	public set mtimeInstant(value: Temporal.Instant) {
		this.mtimeMs = this._convert(value.epochMilliseconds);
	}

	/** Time of last time file status was changed, since epoch */
	public ctimeMs: T;
	declare public ctime: Date;
	public get ctimeInstant(): Temporal.Instant {
		return temporal().Instant.fromEpochMilliseconds(Number(this.ctimeMs));
	}
	public set ctimeInstant(value: Temporal.Instant) {
		this.ctimeMs = this._convert(value.epochMilliseconds);
	}

	/** Time of file creation, since epoch */
	public birthtimeMs: T;
	declare public birthtime: Date;
	public get birthtimeInstant(): Temporal.Instant {
		return temporal().Instant.fromEpochMilliseconds(Number(this.birthtimeMs));
	}
	public set birthtimeInstant(value: Temporal.Instant) {
		this.birthtimeMs = this._convert(value.epochMilliseconds);
	}

	/** Size of the item in bytes. For directories/symlinks, this may be the size of the struct that represents the item. */
	public size: T;

	/** @internal Used by inodes */
	public data?: bigint;

	/** @internal Used by inodes */
	public flags?: number;

	/** @internal Used by inodes */
	public version?: number;

	/** Creates a new stats instance from a stats-like object. Can be used to copy stats (note) */
	public constructor({
		atimeMs,
		mtimeMs,
		ctimeMs,
		birthtimeMs,
		uid,
		gid,
		size,
		mode,
		ino,
		nlink,
		rdev,
		dev,
		blksize,
		...rest
	}: Partial<StatsLike<number | bigint> & InodeFields & StatsExtra<number | bigint>> = {}) {
		const now = Date.now();
		this.atimeMs = this._convert(atimeMs ?? now);
		this.mtimeMs = this._convert(mtimeMs ?? now);
		this.ctimeMs = this._convert(ctimeMs ?? now);
		this.birthtimeMs = this._convert(birthtimeMs ?? now);
		this.uid = this._convert(uid ?? 0);
		this.gid = this._convert(gid ?? 0);
		this.size = this._convert(size ?? 0);
		this.ino = this._convert(ino ?? 0);
		this.nlink = this._convert(nlink ?? 1);
		const numericMode = Number(mode ?? 0o644 & c.S_IFREG);
		this.mode = this._convert(numericMode & c.S_IFMT ? numericMode : numericMode | c.S_IFREG);
		this.rdev = this._convert(rdev ?? 0);
		this.dev = this._convert(dev ?? 0);
		this.blksize = this._convert(blksize ?? 4096);

		Object.assign(this, rest);
	}

	public isFile(): boolean {
		return (Number(this.mode) & c.S_IFMT) === c.S_IFREG;
	}

	public isDirectory(): boolean {
		return (Number(this.mode) & c.S_IFMT) === c.S_IFDIR;
	}

	public isSymbolicLink(): boolean {
		return (Number(this.mode) & c.S_IFMT) === c.S_IFLNK;
	}

	public isSocket(): boolean {
		return (Number(this.mode) & c.S_IFMT) === c.S_IFSOCK;
	}

	public isBlockDevice(): boolean {
		return (Number(this.mode) & c.S_IFMT) === c.S_IFBLK;
	}

	public isCharacterDevice(): boolean {
		return (Number(this.mode) & c.S_IFMT) === c.S_IFCHR;
	}

	public isFIFO(): boolean {
		return (Number(this.mode) & c.S_IFMT) === c.S_IFIFO;
	}

	public toJSON(): StatsLike<T> & Omit<InodeFields, 'data'> {
		return omit(pick(this, ..._inode_fields, 'dev', 'blksize'), 'data');
	}

	/**
	 * Checks if a given user/group has access to this item
	 * @param mode The requested access, combination of W_OK, R_OK, and X_OK
	 * @returns True if the request has access, false if the request does not
	 * @internal
	 */
	public hasAccess(mode: number, context?: V_Context): boolean {
		return hasAccess(context, this._isBigint ? new Stats(this) : (this as unknown as Stats), mode);
	}

	public get atimeNs(): bigint {
		return BigInt(this.atimeMs) * _nsMultiplier;
	}

	public get mtimeNs(): bigint {
		return BigInt(this.mtimeMs) * _nsMultiplier;
	}

	public get ctimeNs(): bigint {
		return BigInt(this.ctimeMs) * _nsMultiplier;
	}

	public get birthtimeNs(): bigint {
		return BigInt(this.birthtimeMs) * _nsMultiplier;
	}
}

/**
 * Like Node, each date is computed from its `*Ms` field when first accessed, then stored as an enumerable own property.
 */
function lazyDate(name: 'atime' | 'mtime' | 'ctime' | 'birthtime'): PropertyDescriptor {
	function store(stats: StatsCommon<number | bigint>, value: Date): Date {
		Object.defineProperty(stats, name, { value, writable: true, enumerable: true, configurable: true });
		return value;
	}

	return {
		enumerable: true,
		configurable: true,
		get(this: StatsCommon<number | bigint>): Date {
			return store(this, new Date(Number(this[`${name}Ms`])));
		},
		set(this: StatsCommon<number | bigint>, value: Date): void {
			store(this, value);
		},
	};
}

Object.defineProperties(StatsCommon.prototype, {
	atime: lazyDate('atime'),
	mtime: lazyDate('mtime'),
	ctime: lazyDate('ctime'),
	birthtime: lazyDate('birthtime'),
});

/**
 * Implementation of Node's `Stats`.
 *
 * Attribute descriptions are from `man 2 stat'
 * @see http://nodejs.org/api/fs.html#fs_class_fs_stats
 * @see http://man7.org/linux/man-pages/man2/stat.2.html
 */
export class Stats extends StatsCommon<number> implements Node.Stats, StatsLike {
	protected get _isBigint(): false {
		return false;
	}
}
Stats satisfies typeof Node.Stats;

/**
 * Stats with bigint
 */
export class BigIntStats extends StatsCommon<bigint> implements Node.BigIntStats, StatsLike {
	protected get _isBigint(): true {
		return true;
	}
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
	/** Fundamental file system block size. */
	public frsize: number = 4096;
	/** Free file nodes in file system. */
	public ffree: number = c.size_max;
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
	public files: bigint = BigInt(c.size_max);
	/** Fundamental file system block size. */
	public frsize: bigint = 4096n;
	/** Free file nodes in file system. */
	public ffree: bigint = BigInt(c.size_max);
}
