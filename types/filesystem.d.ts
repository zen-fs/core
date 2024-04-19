import { ApiError } from './ApiError';
import type { Stats } from './stats';
import { type File } from './file';
import { type Cred } from './cred';
export type NoArgCallback = (e?: ApiError) => unknown;
export type TwoArgCallback<T> = (e?: ApiError, rv?: T) => unknown;
export type ThreeArgCallback<T, U> = (e?: ApiError, arg1?: T, arg2?: U) => unknown;
export type FileContents = Uint8Array | string;
/**
 * Metadata about a FileSystem
 */
export interface FileSystemMetadata {
    /**
     * The name of the FS
     */
    name: string;
    /**
     * Wheter the FS is readonly or not
     */
    readonly: boolean;
    /**
     * Does the FS support properties
     */
    supportsProperties: boolean;
    /**
     * The total space
     */
    totalSpace: number;
    /**
     * The available space
     */
    freeSpace: number;
}
/**
 * Structure for a filesystem. All ZenFS FileSystems must implement this.
 *
 * This class includes some default implementations
 *
 * Assume the following about arguments passed to each API method:
 *
 * - Every path is an absolute path. `.`, `..`, and other items are resolved into an absolute form.
 * - All arguments are present. Any optional arguments at the Node API level have been passed in with their default values.
 */
export declare abstract class FileSystem {
    /**
     * Get metadata about the current file syste,
     */
    metadata(): FileSystemMetadata;
    constructor(options?: object);
    abstract ready(): Promise<this>;
    /**
     * Asynchronous rename. No arguments other than a possible exception
     * are given to the completion callback.
     */
    abstract rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
    /**
     * Synchronous rename.
     */
    abstract renameSync(oldPath: string, newPath: string, cred: Cred): void;
    /**
     * Asynchronous `stat`.
     */
    abstract stat(path: string, cred: Cred): Promise<Stats>;
    /**
     * Synchronous `stat`.
     */
    abstract statSync(path: string, cred: Cred): Stats;
    /**
     * Opens the file at path p with the given flag. The file must exist.
     * @param p The path to open.
     * @param flag The flag to use when opening the file.
     */
    abstract openFile(path: string, flag: string, cred: Cred): Promise<File>;
    /**
     * Opens the file at path p with the given flag. The file must exist.
     * @param p The path to open.
     * @param flag The flag to use when opening the file.
     * @return A File object corresponding to the opened file.
     */
    abstract openFileSync(path: string, flag: string, cred: Cred): File;
    /**
     * Create the file at path p with the given mode. Then, open it with the given
     * flag.
     */
    abstract createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File>;
    /**
     * Create the file at path p with the given mode. Then, open it with the given
     * flag.
     */
    abstract createFileSync(path: string, flag: string, mode: number, cred: Cred): File;
    /**
     * Asynchronous `unlink`.
     */
    abstract unlink(path: string, cred: Cred): Promise<void>;
    /**
     * Synchronous `unlink`.
     */
    abstract unlinkSync(path: string, cred: Cred): void;
    /**
     * Asynchronous `rmdir`.
     */
    abstract rmdir(path: string, cred: Cred): Promise<void>;
    /**
     * Synchronous `rmdir`.
     */
    abstract rmdirSync(path: string, cred: Cred): void;
    /**
     * Asynchronous `mkdir`.
     * @param mode Mode to make the directory using. Can be ignored if
     *   the filesystem doesn't support permissions.
     */
    abstract mkdir(path: string, mode: number, cred: Cred): Promise<void>;
    /**
     * Synchronous `mkdir`.
     * @param mode Mode to make the directory using. Can be ignored if
     *   the filesystem doesn't support permissions.
     */
    abstract mkdirSync(path: string, mode: number, cred: Cred): void;
    /**
     * Asynchronous `readdir`. Reads the contents of a directory.
     *
     * The callback gets two arguments `(err, files)` where `files` is an array of
     * the names of the files in the directory excluding `'.'` and `'..'`.
     */
    abstract readdir(path: string, cred: Cred): Promise<string[]>;
    /**
     * Synchronous `readdir`. Reads the contents of a directory.
     */
    abstract readdirSync(path: string, cred: Cred): string[];
    /**
     * Test whether or not the given path exists by checking with the file system.
     */
    exists(path: string, cred: Cred): Promise<boolean>;
    /**
     * Test whether or not the given path exists by checking with the file system.
     */
    existsSync(path: string, cred: Cred): boolean;
    /**
     * Asynchronous `link`.
     */
    abstract link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;
    /**
     * Synchronous `link`.
     */
    abstract linkSync(srcpath: string, dstpath: string, cred: Cred): void;
    /**
     * Synchronize the data and stats for path asynchronously
     */
    abstract sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
    /**
     * Synchronize the data and stats for path synchronously
     */
    abstract syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
}
/**
 * @internal
 */
declare abstract class SyncFileSystem extends FileSystem {
    metadata(): FileSystemMetadata;
    ready(): Promise<this>;
    exists(path: string, cred: Cred): Promise<boolean>;
    rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
    stat(path: string, cred: Cred): Promise<Stats>;
    createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File>;
    openFile(path: string, flag: string, cred: Cred): Promise<File>;
    unlink(path: string, cred: Cred): Promise<void>;
    rmdir(path: string, cred: Cred): Promise<void>;
    mkdir(path: string, mode: number, cred: Cred): Promise<void>;
    readdir(path: string, cred: Cred): Promise<string[]>;
    link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;
    sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
}
/**
 * Implements the asynchronous API in terms of the synchronous API.
 */
export declare function Sync<T extends abstract new (...args: any[]) => FileSystem>(FS: T): (abstract new (...args: any[]) => SyncFileSystem) & T;
/**
 * @internal
 */
declare abstract class AsyncFileSystem extends FileSystem {
    /**
     * @hidden
     */
    abstract _sync: FileSystem;
    metadata(): FileSystemMetadata;
    ready(): Promise<this>;
    renameSync(oldPath: string, newPath: string, cred: Cred): void;
    statSync(path: string, cred: Cred): Stats;
    createFileSync(path: string, flag: string, mode: number, cred: Cred): File;
    openFileSync(path: string, flag: string, cred: Cred): File;
    unlinkSync(path: string, cred: Cred): void;
    rmdirSync(path: string, cred: Cred): void;
    mkdirSync(path: string, mode: number, cred: Cred): void;
    readdirSync(path: string, cred: Cred): string[];
    linkSync(srcpath: string, dstpath: string, cred: Cred): void;
    syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
}
/**
 * Async() implements synchronous methods on an asynchronous file system
 *
 * Implementing classes must define a protected _sync property for the synchronous file system used as a cache.
 * by:
 *
 * - Performing operations over the in-memory copy, while asynchronously pipelining them
 *   to the backing store.
 * - During application loading, the contents of the async file system can be reloaded into
 *   the synchronous store, if desired.
 *
 */
export declare function Async<T extends abstract new (...args: any[]) => FileSystem>(FS: T): (abstract new (...args: any[]) => AsyncFileSystem) & T;
/**
 * @internal
 */
declare abstract class ReadonlyFileSystem extends FileSystem {
    metadata(): FileSystemMetadata;
    rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
    renameSync(oldPath: string, newPath: string, cred: Cred): void;
    createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File>;
    createFileSync(path: string, flag: string, mode: number, cred: Cred): File;
    unlink(path: string, cred: Cred): Promise<void>;
    unlinkSync(path: string, cred: Cred): void;
    rmdir(path: string, cred: Cred): Promise<void>;
    rmdirSync(path: string, cred: Cred): void;
    mkdir(path: string, mode: number, cred: Cred): Promise<void>;
    mkdirSync(path: string, mode: number, cred: Cred): void;
    link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;
    linkSync(srcpath: string, dstpath: string, cred: Cred): void;
    sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
    syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
}
export declare function Readonly<T extends abstract new (...args: any[]) => FileSystem>(FS: T): (abstract new (...args: any[]) => ReadonlyFileSystem) & T;
export {};
