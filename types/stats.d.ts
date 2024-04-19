/// <reference types="node" />
import type * as Node from 'fs';
import { Cred } from './cred';
/**
 * Indicates the type of the given file. Applied to 'mode'.
 */
export declare enum FileType {
    FILE = 32768,
    DIRECTORY = 16384,
    SYMLINK = 40960
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
export declare abstract class StatsCommon<T extends number | bigint> implements Node.StatsBase<T>, StatsLike {
    protected abstract _isBigint: boolean;
    protected get _typename(): string;
    protected get _typename_inverse(): string;
    protected _convert(arg: number | bigint | string | boolean): T;
    blocks: T;
    /**
     * Unix-style file mode (e.g. 0o644) that includes the type of the item.
     * Type of the item can be FILE, DIRECTORY, SYMLINK, or SOCKET
     */
    mode: T;
    /**
     * ID of device containing file
     */
    dev: T;
    /**
     * inode number
     */
    ino: T;
    /**
     * device ID (if special file)
     */
    rdev: T;
    /**
     * number of hard links
     */
    nlink: T;
    /**
     * blocksize for file system I/O
     */
    blksize: T;
    /**
     * user ID of owner
     */
    uid: T;
    /**
     * group ID of owner
     */
    gid: T;
    /**
     * Some file systems stash data on stats objects.
     */
    fileData?: Uint8Array;
    /**
     * time of last access, in milliseconds since epoch
     */
    atimeMs: T;
    get atime(): Date;
    set atime(value: Date);
    /**
     * time of last modification, in milliseconds since epoch
     */
    mtimeMs: T;
    get mtime(): Date;
    set mtime(value: Date);
    /**
     * time of last time file status was changed, in milliseconds since epoch
     */
    ctimeMs: T;
    get ctime(): Date;
    set ctime(value: Date);
    /**
     * time of file creation, in milliseconds since epoch
     */
    birthtimeMs: T;
    get birthtime(): Date;
    set birthtime(value: Date);
    /**
     * Size of the item in bytes.
     * For directories/symlinks, this is normally the size of the struct that represents the item.
     */
    size: T;
    /**
     * Creates a new stats instance from a stats-like object. Can be used to copy stats (note)
     */
    constructor({ atimeMs, mtimeMs, ctimeMs, birthtimeMs, uid, gid, size, mode }?: Partial<StatsLike>);
    /**
     * @returns true if this item is a file.
     */
    isFile(): boolean;
    /**
     * @returns True if this item is a directory.
     */
    isDirectory(): boolean;
    /**
     * @returns true if this item is a symbolic link
     */
    isSymbolicLink(): boolean;
    isSocket(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    /**
     * Checks if a given user/group has access to this item
     * @param mode The requested access, combination of W_OK, R_OK, and X_OK
     * @param cred The requesting credentials
     * @returns True if the request has access, false if the request does not
     * @internal
     */
    hasAccess(mode: number, cred: Cred): boolean;
    /**
     * Convert the current stats object into a credentials object
     * @internal
     */
    cred(uid?: number, gid?: number): Cred;
    /**
     * Change the mode of the file. We use this helper function to prevent messing
     * up the type of the file, which is encoded in mode.
     * @internal
     */
    chmod(mode: number): void;
    /**
     * Change the owner user/group of the file.
     * This function makes sure it is a valid UID/GID (that is, a 32 unsigned int)
     * @internal
     */
    chown(uid: number | bigint, gid: number | bigint): void;
}
/**
 * Implementation of Node's `Stats`.
 *
 * Attribute descriptions are from `man 2 stat'
 * @see http://nodejs.org/api/fs.html#fs_class_fs_stats
 * @see http://man7.org/linux/man-pages/man2/stat.2.html
 */
export declare class Stats extends StatsCommon<number> implements Node.Stats, StatsLike {
    protected _isBigint: boolean;
    /**
     * Clones the stats object.
     * @deprecated use `new Stats(stats)`
     */
    static clone(stats: Stats): Stats;
}
/**
 * Stats with bigint
 * @todo Implement with bigint instead of wrapping Stats
 */
export declare class BigIntStats extends StatsCommon<bigint> implements Node.BigIntStats, StatsLike {
    protected _isBigint: boolean;
    atimeNs: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    birthtimeNs: bigint;
    /**
     * Clone a stats object.
     * @deprecated use `new BigIntStats(stats)`
     */
    static clone(stats: BigIntStats | Stats): BigIntStats;
}
export declare class StatsFs implements Node.StatsFsBase<number> {
    /** Type of file system. */
    type: number;
    /**  Optimal transfer block size. */
    bsize: number;
    /**  Total data blocks in file system. */
    blocks: number;
    /** Free blocks in file system. */
    bfree: number;
    /** Available blocks for unprivileged users */
    bavail: number;
    /** Total file nodes in file system. */
    files: number;
    /** Free file nodes in file system. */
    ffree: number;
}
export declare class BigIntStatsFs implements Node.StatsFsBase<bigint> {
    /** Type of file system. */
    type: bigint;
    /**  Optimal transfer block size. */
    bsize: bigint;
    /**  Total data blocks in file system. */
    blocks: bigint;
    /** Free blocks in file system. */
    bfree: bigint;
    /** Available blocks for unprivileged users */
    bavail: bigint;
    /** Total file nodes in file system. */
    files: bigint;
    /** Free file nodes in file system. */
    ffree: bigint;
}
