import { FileSystem, FileSystemMetadata } from '../filesystem';
import { File } from '../file';
import { Stats } from '../stats';
import { LockedFS } from './Locked';
import { Cred } from '../cred';
/**
 * Configuration options for OverlayFS instances.
 */
export interface OverlayOptions {
    /**
     * The file system to write modified files to.
     */
    writable: FileSystem;
    /**
     * The file system that initially populates this file system.
     */
    readable: FileSystem;
}
/**
 * OverlayFS makes a read-only filesystem writable by storing writes on a second, writable file system.
 * Deletes are persisted via metadata stored on the writable file system.
 *
 * This class contains no locking whatsoever. It is wrapped in a LockedFS to prevent races.
 *
 * @internal
 */
export declare class UnlockedOverlayFS extends FileSystem {
    ready(): Promise<this>;
    private _writable;
    private _readable;
    private _isInitialized;
    private _deletedFiles;
    private _deleteLog;
    private _deleteLogUpdatePending;
    private _deleteLogUpdateNeeded;
    private _deleteLogError?;
    private _ready;
    constructor({ writable, readable }: OverlayOptions);
    metadata(): FileSystemMetadata;
    getOverlayedFileSystems(): OverlayOptions;
    sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
    syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
    /**
     * Called once to load up metadata stored on the writable file system.
     * @internal
     */
    _initialize(): Promise<void>;
    getDeletionLog(): string;
    restoreDeletionLog(log: string, cred: Cred): void;
    rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
    renameSync(oldPath: string, newPath: string, cred: Cred): void;
    stat(p: string, cred: Cred): Promise<Stats>;
    statSync(p: string, cred: Cred): Stats;
    openFile(path: string, flag: string, cred: Cred): Promise<File>;
    openFileSync(path: string, flag: string, cred: Cred): File;
    createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File>;
    createFileSync(path: string, flag: string, mode: number, cred: Cred): File;
    link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;
    linkSync(srcpath: string, dstpath: string, cred: Cred): void;
    unlink(p: string, cred: Cred): Promise<void>;
    unlinkSync(p: string, cred: Cred): void;
    rmdir(p: string, cred: Cred): Promise<void>;
    rmdirSync(p: string, cred: Cred): void;
    mkdir(p: string, mode: number, cred: Cred): Promise<void>;
    mkdirSync(p: string, mode: number, cred: Cred): void;
    readdir(p: string, cred: Cred): Promise<string[]>;
    readdirSync(p: string, cred: Cred): string[];
    private deletePath;
    private updateLog;
    private _reparseDeletionLog;
    private checkInitialized;
    private checkPath;
    /**
     * With the given path, create the needed parent directories on the writable storage
     * should they not exist. Use modes from the read-only storage.
     */
    private createParentDirectoriesSync;
    private createParentDirectories;
    /**
     * Helper function:
     * - Ensures p is on writable before proceeding. Throws an error if it doesn't exist.
     * - Calls f to perform operation on writable.
     */
    private operateOnWritable;
    private operateOnWritableAsync;
    /**
     * Copy from readable to writable storage.
     * PRECONDITION: File does not exist on writable storage.
     */
    private copyToWritableSync;
    private copyToWritable;
}
/**
 * OverlayFS makes a read-only filesystem writable by storing writes on a second,
 * writable file system. Deletes are persisted via metadata stored on the writable
 * file system.
 * @internal
 */
export declare class OverlayFS extends LockedFS<UnlockedOverlayFS> {
    ready(): Promise<this>;
    /**
     * @param options The options to initialize the OverlayFS with
     */
    constructor(options: OverlayOptions);
    getOverlayedFileSystems(): OverlayOptions;
    getDeletionLog(): string;
    resDeletionLog(): string;
    unwrap(): UnlockedOverlayFS;
}
export declare const Overlay: {
    readonly name: "Overlay";
    readonly options: {
        readonly writable: {
            readonly type: "object";
            readonly required: true;
            readonly description: "The file system to write modified files to.";
        };
        readonly readable: {
            readonly type: "object";
            readonly required: true;
            readonly description: "The file system that initially populates this file system.";
        };
    };
    readonly isAvailable: () => boolean;
    readonly create: (options: OverlayOptions) => OverlayFS;
};
