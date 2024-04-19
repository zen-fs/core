import type { Cred } from '../cred';
import { PreloadFile } from '../file';
import { FileSystem, type FileSystemMetadata } from '../filesystem';
import { type Ino } from '../inode';
import { type Stats } from '../stats';
/**
 * Represents an asynchronous key-value store.
 */
export interface AsyncStore {
    /**
     * The name of the store.
     */
    name: string;
    /**
     * Empties the store completely.
     */
    clear(): Promise<void>;
    /**
     * Begins a transaction.
     */
    beginTransaction(): AsyncTransaction;
}
/**
 * Represents an asynchronous transaction.
 */
export interface AsyncTransaction {
    /**
     * Retrieves the data at the given key.
     * @param key The key to look under for data.
     */
    get(key: Ino): Promise<Uint8Array>;
    /**
     * Adds the data to the store under the given key. Overwrites any existing
     * data.
     * @param key The key to add the data under.
     * @param data The data to add to the store.
     * @param overwrite If 'true', overwrite any existing data. If 'false',
     *   avoids writing the data if the key exists.
     */
    put(key: Ino, data: Uint8Array, overwrite: boolean): Promise<boolean>;
    /**
     * Deletes the data at the given key.
     * @param key The key to delete from the store.
     */
    remove(key: Ino): Promise<void>;
    /**
     * Commits the transaction.
     */
    commit(): Promise<void>;
    /**
     * Aborts and rolls back the transaction.
     */
    abort(): Promise<void>;
}
export interface AsyncStoreOptions {
    /**
     * Promise that resolves to the store
     */
    store: Promise<AsyncStore> | AsyncStore;
    /**
     * The size of the cache. If not provided, no cache will be used
     */
    lruCacheSize?: number;
    /**
     * The file system to use for synchronous methods. Defaults to InMemory
     */
    sync?: FileSystem;
}
declare const AsyncStoreFS_base: (abstract new (...args: any[]) => {
    _sync: FileSystem;
    metadata(): FileSystemMetadata;
    ready(): Promise<any>;
    renameSync(oldPath: string, newPath: string, cred: Cred): void;
    statSync(path: string, cred: Cred): Stats;
    createFileSync(path: string, flag: string, mode: number, cred: Cred): import("../file").File;
    openFileSync(path: string, flag: string, cred: Cred): import("../file").File;
    unlinkSync(path: string, cred: Cred): void;
    rmdirSync(path: string, cred: Cred): void;
    mkdirSync(path: string, mode: number, cred: Cred): void;
    readdirSync(path: string, cred: Cred): string[];
    linkSync(srcpath: string, dstpath: string, cred: Cred): void;
    syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
    rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
    stat(path: string, cred: Cred): Promise<Stats>;
    openFile(path: string, flag: string, cred: Cred): Promise<import("../file").File>;
    createFile(path: string, flag: string, mode: number, cred: Cred): Promise<import("../file").File>;
    unlink(path: string, cred: Cred): Promise<void>;
    rmdir(path: string, cred: Cred): Promise<void>;
    mkdir(path: string, mode: number, cred: Cred): Promise<void>;
    readdir(path: string, cred: Cred): Promise<string[]>;
    exists(path: string, cred: Cred): Promise<boolean>;
    existsSync(path: string, cred: Cred): boolean;
    link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;
    sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
}) & typeof FileSystem;
/**
 * An asynchronous file system which uses an async store to store its data.
 * @see AsyncStore
 * @internal
 */
export declare class AsyncStoreFS extends AsyncStoreFS_base {
    protected _options: AsyncStoreOptions;
    protected store: AsyncStore;
    private _cache?;
    _sync: FileSystem;
    ready(): Promise<this>;
    metadata(): FileSystemMetadata;
    constructor(_options: AsyncStoreOptions);
    /**
     * Delete all contents stored in the file system.
     */
    empty(): Promise<void>;
    /**
     * @todo Make rename compatible with the cache.
     */
    rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
    stat(p: string, cred: Cred): Promise<Stats>;
    createFile(p: string, flag: string, mode: number, cred: Cred): Promise<PreloadFile<this>>;
    openFile(p: string, flag: string, cred: Cred): Promise<PreloadFile<this>>;
    unlink(p: string, cred: Cred): Promise<void>;
    rmdir(p: string, cred: Cred): Promise<void>;
    mkdir(p: string, mode: number, cred: Cred): Promise<void>;
    readdir(p: string, cred: Cred): Promise<string[]>;
    /**
     * Updated the inode and data node at the given path
     * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
     */
    sync(p: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
    link(existing: string, newpath: string, cred: Cred): Promise<void>;
    /**
     * Checks if the root directory exists. Creates it if it doesn't.
     */
    private makeRootDirectory;
    /**
     * Helper function for findINode.
     * @param parent The parent directory of the file we are attempting to find.
     * @param filename The filename of the inode we are attempting to find, minus
     *   the parent.
     */
    private _findINode;
    /**
     * Finds the Inode of the given path.
     * @param p The path to look up.
     * @todo memoize/cache
     */
    private findINode;
    /**
     * Given the ID of a node, retrieves the corresponding Inode.
     * @param tx The transaction to use.
     * @param p The corresponding path to the file (used for error messages).
     * @param id The ID to look up.
     */
    private getINode;
    /**
     * Given the Inode of a directory, retrieves the corresponding directory
     * listing.
     */
    private getDirListing;
    /**
     * Adds a new node under a random ID. Retries 5 times before giving up in
     * the exceedingly unlikely chance that we try to reuse a random ino.
     */
    private addNewNode;
    /**
     * Commits a new file (well, a FILE or a DIRECTORY) to the file system with
     * the given mode.
     * Note: This will commit the transaction.
     * @param p The path to the new file.
     * @param type The type of the new file.
     * @param mode The mode to create the new file with.
     * @param cred The UID/GID to create the file with
     * @param data The data to store at the file's data node.
     */
    private commitNewFile;
    /**
     * Remove all traces of the given path from the file system.
     * @param p The path to remove from the file system.
     * @param isDir Does the path belong to a directory, or a file?
     * @todo Update mtime.
     */
    /**
     * Remove all traces of the given path from the file system.
     * @param p The path to remove from the file system.
     * @param isDir Does the path belong to a directory, or a file?
     * @todo Update mtime.
     */
    private removeEntry;
}
export {};
