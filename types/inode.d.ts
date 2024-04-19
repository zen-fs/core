import { Stats, type StatsLike } from './stats';
/**
 * Alias for an ino.
 * This will be helpful if in the future inode numbers/IDs are changed to strings or numbers.
 */
export type Ino = bigint;
/**
 * Max 32-bit integer
 * @hidden
 */
export declare const size_max: number;
/**
 * Room inode
 * @hidden
 */
export declare const rootIno: Ino;
/**
 * Generate a random ino
 * @internal
 */
export declare function randomIno(): Ino;
/**
 * Generic inode definition that can easily be serialized.
 */
export declare class Inode implements StatsLike {
    readonly buffer: ArrayBufferLike;
    get data(): Uint8Array;
    protected view: DataView;
    constructor(buffer?: ArrayBufferLike);
    get ino(): Ino;
    set ino(value: Ino);
    get size(): number;
    set size(value: number);
    get mode(): number;
    set mode(value: number);
    get nlink(): number;
    set nlink(value: number);
    get uid(): number;
    set uid(value: number);
    get gid(): number;
    set gid(value: number);
    get atimeMs(): number;
    set atimeMs(value: number);
    get birthtimeMs(): number;
    set birthtimeMs(value: number);
    get mtimeMs(): number;
    set mtimeMs(value: number);
    get ctimeMs(): number;
    set ctimeMs(value: number);
    /**
     * Handy function that converts the Inode to a Node Stats object.
     */
    toStats(): Stats;
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
    update(stats: Readonly<Stats>): boolean;
}
