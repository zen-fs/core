import { Cred } from '../cred';
import { PreloadFile } from '../file';
import { type FileSystemMetadata, FileSystem } from '../filesystem';
import { type Ino, Inode } from '../inode';
import { type Stats, FileType } from '../stats';
/**
 * Represents a *synchronous* key-value store.
 */
export interface SyncStore {
    /**
     * The name of the key-value store.
     */
    name: string;
    /**
     * Empties the key-value store completely.
     */
    clear(): void;
    /**
     * Begins a new transaction.
     */
    beginTransaction(): SyncTransaction;
}
/**
 * A transaction for a synchronous key value store.
 */
export interface SyncTransaction {
    /**
     * Retrieves the data at the given key. Throws an ApiError if an error occurs
     * or if the key does not exist.
     * @param ino The key to look under for data.
     * @return The data stored under the key, or undefined if not present.
     */
    get(ino: Ino): Uint8Array | undefined;
    /**
     * Adds the data to the store under the given key.
     * @param ino The key to add the data under.
     * @param data The data to add to the store.
     * @param overwrite If 'true', overwrite any existing data. If 'false',
     *   avoids storing the data if the key exists.
     * @return True if storage succeeded, false otherwise.
     */
    put(ino: Ino, data: Uint8Array, overwrite: boolean): boolean;
    /**
     * Deletes the data at the given key.
     * @param ino The key to delete from the store.
     */
    remove(ino: Ino): void;
    /**
     * Commits the transaction.
     */
    commit(): void;
    /**
     * Aborts and rolls back the transaction.
     */
    abort(): void;
}
/**
 * An interface for simple synchronous key-value stores that don't have special
 * support for transactions and such.
 */
export interface SimpleSyncStore {
    get(ino: Ino): Uint8Array | undefined;
    put(ino: Ino, data: Uint8Array, overwrite: boolean): boolean;
    remove(ino: Ino): void;
}
/**
 * A simple RW transaction for simple synchronous key-value stores.
 */
export declare class SimpleSyncTransaction implements SyncTransaction {
    protected store: SimpleSyncStore;
    /**
     * Stores data in the keys we modify prior to modifying them.
     * Allows us to roll back commits.
     */
    protected originalData: Map<Ino, Uint8Array>;
    /**
     * List of keys modified in this transaction, if any.
     */
    protected modifiedKeys: Set<Ino>;
    constructor(store: SimpleSyncStore);
    get(ino: Ino): Uint8Array | undefined;
    put(ino: Ino, data: Uint8Array, overwrite: boolean): boolean;
    remove(ino: Ino): void;
    commit(): void;
    abort(): void;
    /**
     * Stashes given key value pair into `originalData` if it doesn't already
     * exist. Allows us to stash values the program is requesting anyway to
     * prevent needless `get` requests if the program modifies the data later
     * on during the transaction.
     */
    protected stashOldValue(ino: Ino, value: Uint8Array | undefined): void;
    /**
     * Marks the given key as modified, and stashes its value if it has not been
     * stashed already.
     */
    protected markModified(ino: Ino): void;
}
export interface SyncStoreOptions {
    /**
     * The actual key-value store to read from/write to.
     */
    store: SyncStore;
}
declare const SyncStoreFS_base: (abstract new (...args: any[]) => {
    metadata(): FileSystemMetadata;
    ready(): Promise<any>;
    exists(path: string, cred: Cred): Promise<boolean>;
    rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
    stat(path: string, cred: Cred): Promise<Stats>;
    createFile(path: string, flag: string, mode: number, cred: Cred): Promise<import("../file").File>;
    openFile(path: string, flag: string, cred: Cred): Promise<import("../file").File>;
    unlink(path: string, cred: Cred): Promise<void>;
    rmdir(path: string, cred: Cred): Promise<void>;
    mkdir(path: string, mode: number, cred: Cred): Promise<void>;
    readdir(path: string, cred: Cred): Promise<string[]>;
    link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;
    sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
    renameSync(oldPath: string, newPath: string, cred: Cred): void;
    statSync(path: string, cred: Cred): Stats;
    openFileSync(path: string, flag: string, cred: Cred): import("../file").File;
    createFileSync(path: string, flag: string, mode: number, cred: Cred): import("../file").File;
    unlinkSync(path: string, cred: Cred): void;
    rmdirSync(path: string, cred: Cred): void;
    mkdirSync(path: string, mode: number, cred: Cred): void;
    readdirSync(path: string, cred: Cred): string[];
    existsSync(path: string, cred: Cred): boolean;
    linkSync(srcpath: string, dstpath: string, cred: Cred): void;
    syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
}) & typeof FileSystem;
/**
 * A synchronous key-value file system. Uses a SyncStore to store the data.
 *
 * We use a unique ID for each node in the file system. The root node has a fixed ID.
 * @todo Introduce Node ID caching.
 * @todo Check modes.
 * @internal
 */
export declare class SyncStoreFS extends SyncStoreFS_base {
    protected store: SyncStore;
    constructor(options: SyncStoreOptions);
    metadata(): FileSystemMetadata;
    /**
     * Delete all contents stored in the file system.
     */
    empty(): void;
    renameSync(oldPath: string, newPath: string, cred: Cred): void;
    statSync(p: string, cred: Cred): Stats;
    createFileSync(p: string, flag: string, mode: number, cred: Cred): PreloadFile<this>;
    openFileSync(p: string, flag: string, cred: Cred): PreloadFile<this>;
    unlinkSync(p: string, cred: Cred): void;
    rmdirSync(p: string, cred: Cred): void;
    mkdirSync(p: string, mode: number, cred: Cred): void;
    readdirSync(p: string, cred: Cred): string[];
    syncSync(p: string, data: Uint8Array, stats: Readonly<Stats>): void;
    linkSync(existing: string, newpath: string, cred: Cred): void;
    /**
     * Checks if the root directory exists. Creates it if it doesn't.
     */
    protected makeRootDirectory(): void;
    /**
     * Helper function for findINode.
     * @param parent The parent directory of the file we are attempting to find.
     * @param filename The filename of the inode we are attempting to find, minus
     *   the parent.
     * @return string The ID of the file's inode in the file system.
     */
    protected _findINode(tx: SyncTransaction, parent: string, filename: string, visited?: Set<string>): Ino;
    /**
     * Finds the Inode of the given path.
     * @param p The path to look up.
     * @return The Inode of the path p.
     * @todo memoize/cache
     */
    protected findINode(tx: SyncTransaction, p: string): Inode;
    /**
     * Given the ID of a node, retrieves the corresponding Inode.
     * @param tx The transaction to use.
     * @param p The corresponding path to the file (used for error messages).
     * @param id The ID to look up.
     */
    protected getINode(tx: SyncTransaction, id: Ino, p?: string): Inode;
    /**
     * Given the Inode of a directory, retrieves the corresponding directory listing.
     */
    protected getDirListing(tx: SyncTransaction, inode: Inode, p?: string): {
        [fileName: string]: Ino;
    };
    /**
     * Creates a new node under a random ID. Retries 5 times before giving up in
     * the exceedingly unlikely chance that we try to reuse a random GUID.
     * @return The GUID that the data was stored under.
     */
    protected addNewNode(tx: SyncTransaction, data: Uint8Array, _maxAttempts?: number): Ino;
    /**
     * Commits a new file (well, a FILE or a DIRECTORY) to the file system with the given mode.
     * Note: This will commit the transaction.
     * @param p The path to the new file.
     * @param type The type of the new file.
     * @param mode The mode to create the new file with.
     * @param data The data to store at the file's data node.
     * @return The Inode for the new file.
     */
    protected commitNewFile(p: string, type: FileType, mode: number, cred: Cred, data?: Uint8Array): Inode;
    /**
     * Remove all traces of the given path from the file system.
     * @param p The path to remove from the file system.
     * @param isDir Does the path belong to a directory, or a file?
     * @todo Update mtime.
     */
    protected removeEntry(p: string, isDir: boolean, cred: Cred): void;
}
export {};
