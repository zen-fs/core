import type { Cred } from '../cred';
import type { File } from '../file';
import type { FileSystem, FileSystemMetadata } from '../filesystem';
import type { Stats } from '../stats';
/**
 * This class serializes access to an underlying async filesystem.
 * For example, on an OverlayFS instance with an async lower
 * directory operations like rename and rmdir may involve multiple
 * requests involving both the upper and lower filesystems -- they
 * are not executed in a single atomic step.  OverlayFS uses this
 * LockedFS to avoid having to reason about the correctness of
 * multiple requests interleaving.
 * @internal
 */
export declare class LockedFS<FS extends FileSystem> implements FileSystem {
    readonly fs: FS;
    private _mu;
    constructor(fs: FS);
    ready(): Promise<this>;
    metadata(): FileSystemMetadata;
    rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
    renameSync(oldPath: string, newPath: string, cred: Cred): void;
    stat(p: string, cred: Cred): Promise<Stats>;
    statSync(p: string, cred: Cred): Stats;
    openFile(path: string, flag: string, cred: Cred): Promise<File>;
    openFileSync(path: string, flag: string, cred: Cred): File;
    createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File>;
    createFileSync(path: string, flag: string, mode: number, cred: Cred): File;
    unlink(p: string, cred: Cred): Promise<void>;
    unlinkSync(p: string, cred: Cred): void;
    rmdir(p: string, cred: Cred): Promise<void>;
    rmdirSync(p: string, cred: Cred): void;
    mkdir(p: string, mode: number, cred: Cred): Promise<void>;
    mkdirSync(p: string, mode: number, cred: Cred): void;
    readdir(p: string, cred: Cred): Promise<string[]>;
    readdirSync(p: string, cred: Cred): string[];
    exists(p: string, cred: Cred): Promise<boolean>;
    existsSync(p: string, cred: Cred): boolean;
    link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;
    linkSync(srcpath: string, dstpath: string, cred: Cred): void;
    sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
    syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
}
