/// <reference types="node" />
/// <reference types="node" />
import { Cred } from '../cred';
import { FileSystem } from '../filesystem';
import type { File } from '../file';
import type { EncodingOption, OpenMode, WriteFileOptions } from 'node:fs';
/**
 * converts Date or number to a integer UNIX timestamp
 * Grabbed from NodeJS sources (lib/fs.js)
 *
 * @internal
 */
export declare function _toUnixTimestamp(time: Date | number): number;
/**
 * Normalizes a mode
 * @internal
 */
export declare function normalizeMode(mode: string | number | unknown, def?: number): number;
/**
 * Normalizes a time
 * @internal
 */
export declare function normalizeTime(time: string | number | Date): Date;
/**
 * Normalizes a path
 * @internal
 */
export declare function normalizePath(p: string): string;
/**
 * Normalizes options
 * @param options options to normalize
 * @param encoding default encoding
 * @param flag default flag
 * @param mode default mode
 * @internal
 */
export declare function normalizeOptions(options?: WriteFileOptions | (EncodingOption & {
    flag?: OpenMode;
}), encoding?: BufferEncoding, flag?: string, mode?: number): {
    encoding: BufferEncoding;
    flag: string;
    mode: number;
};
/**
 * Do nothing
 * @internal
 */
export declare function nop(): void;
export declare let cred: Cred;
export declare function setCred(val: Cred): void;
export declare const fdMap: Map<number, File>;
export declare function getFdForFile(file: File): number;
export declare function fd2file(fd: number): File;
export interface MountMapping {
    [point: string]: FileSystem;
}
/**
 * The map of mount points
 * @internal
 */
export declare const mounts: Map<string, FileSystem>;
/**
 * Mounts the file system at the given mount point.
 */
export declare function mount(mountPoint: string, fs: FileSystem): void;
/**
 * Unmounts the file system at the given mount point.
 */
export declare function umount(mountPoint: string): void;
/**
 * Gets the internal FileSystem for the path, then returns it along with the path relative to the FS' root
 */
export declare function resolveMount(path: string): {
    fs: FileSystem;
    path: string;
    mountPoint: string;
};
/**
 * Reverse maps the paths in text from the mounted FileSystem to the global path
 */
export declare function fixPaths(text: string, paths: {
    [from: string]: string;
}): string;
export declare function fixError<E extends Error>(e: E, paths: {
    [from: string]: string;
}): E;
export declare function mountMapping(mountMapping: MountMapping): void;
/**
 * Types supports as path parameters.
 *
 * In the future, maybe support URL?
 */
export type PathLike = string;
