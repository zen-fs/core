/// <reference types="node" />
/// <reference types="node" />
import type { FileReadResult } from 'node:fs/promises';
import type { FileSystem } from './filesystem';
import { Stats, type FileType } from './stats';
declare global {
    interface ArrayBuffer {
        readonly resizable: boolean;
        readonly maxByteLength?: number;
        resize(newLength: number): void;
    }
    interface SharedArrayBuffer {
        readonly resizable: boolean;
        readonly maxByteLength?: number;
        resize(newLength: number): void;
    }
    interface ArrayBufferConstructor {
        new (byteLength: number, options: {
            maxByteLength?: number;
        }): ArrayBuffer;
    }
}
/**
 * @hidden
 */
export declare enum ActionType {
    NOP = 0,
    THROW = 1,
    TRUNCATE = 2,
    CREATE = 3
}
export declare function parseFlag(flag: string | number): string;
export declare function flagToString(flag: number): string;
export declare function flagToNumber(flag: string): number;
/**
 * Parses a flag as a mode (W_OK, R_OK, and/or X_OK)
 * @param flag the flag to parse
 */
export declare function flagToMode(flag: string): number;
export declare function isReadable(flag: string): boolean;
export declare function isWriteable(flag: string): boolean;
export declare function isTruncating(flag: string): boolean;
export declare function isAppendable(flag: string): boolean;
export declare function isSynchronous(flag: string): boolean;
export declare function isExclusive(flag: string): boolean;
export declare function pathExistsAction(flag: string): ActionType;
export declare function pathNotExistsAction(flag: string): ActionType;
export declare abstract class File {
    /**
     * Get the current file position.
     */
    abstract position?: number;
    /**
     * The path to the file
     */
    abstract readonly path?: string;
    /**
     * Asynchronous `stat`.
     */
    abstract stat(): Promise<Stats>;
    /**
     * Synchronous `stat`.
     */
    abstract statSync(): Stats;
    /**
     * Asynchronous close.
     */
    abstract close(): Promise<void>;
    /**
     * Synchronous close.
     */
    abstract closeSync(): void;
    /**
     * Asynchronous truncate.
     */
    abstract truncate(len: number): Promise<void>;
    /**
     * Synchronous truncate.
     */
    abstract truncateSync(len: number): void;
    /**
     * Asynchronous sync.
     */
    abstract sync(): Promise<void>;
    /**
     * Synchronous sync.
     */
    abstract syncSync(): void;
    /**
     * Write buffer to the file.
     * Note that it is unsafe to use fs.write multiple times on the same file
     * without waiting for the callback.
     * @param buffer Uint8Array containing the data to write to
     *  the file.
     * @param offset Offset in the buffer to start reading data from.
     * @param length The amount of bytes to write to the file.
     * @param position Offset from the beginning of the file where this
     *   data should be written. If position is null, the data will be written at
     *   the current position.
     * @returns Promise resolving to the new length of the buffer
     */
    abstract write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number>;
    /**
     * Write buffer to the file.
     * Note that it is unsafe to use fs.writeSync multiple times on the same file
     * without waiting for it to return.
     * @param buffer Uint8Array containing the data to write to
     *  the file.
     * @param offset Offset in the buffer to start reading data from.
     * @param length The amount of bytes to write to the file.
     * @param position Offset from the beginning of the file where this
     *   data should be written. If position is null, the data will be written at
     *   the current position.
     */
    abstract writeSync(buffer: Uint8Array, offset?: number, length?: number, position?: number): number;
    /**
     * Read data from the file.
     * @param buffer The buffer that the data will be
     *   written to.
     * @param offset The offset within the buffer where writing will
     *   start.
     * @param length An integer specifying the number of bytes to read.
     * @param position An integer specifying where to begin reading from
     *   in the file. If position is null, data will be read from the current file
     *   position.
     * @returns Promise resolving to the new length of the buffer
     */
    abstract read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<FileReadResult<TBuffer>>;
    /**
     * Read data from the file.
     * @param buffer The buffer that the data will be written to.
     * @param offset The offset within the buffer where writing will start.
     * @param length An integer specifying the number of bytes to read.
     * @param position An integer specifying where to begin reading from
     *   in the file. If position is null, data will be read from the current file
     *   position.
     */
    abstract readSync(buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number;
    /**
     * Asynchronous `datasync`.
     *
     * Default implementation maps to `sync`.
     */
    datasync(): Promise<void>;
    /**
     * Synchronous `datasync`.
     *
     * Default implementation maps to `syncSync`.
     */
    datasyncSync(): void;
    /**
     * Asynchronous `chown`.
     */
    abstract chown(uid: number, gid: number): Promise<void>;
    /**
     * Synchronous `chown`.
     */
    abstract chownSync(uid: number, gid: number): void;
    /**
     * Asynchronous `fchmod`.
     */
    abstract chmod(mode: number): Promise<void>;
    /**
     * Synchronous `fchmod`.
     */
    abstract chmodSync(mode: number): void;
    /**
     * Change the file timestamps of the file.
     */
    abstract utimes(atime: Date, mtime: Date): Promise<void>;
    /**
     * Change the file timestamps of the file.
     */
    abstract utimesSync(atime: Date, mtime: Date): void;
    /**
     * Set the file type
     * @internal
     */
    abstract _setType(type: FileType): Promise<void>;
    /**
     * Set the file type
     * @internal
     */
    abstract _setTypeSync(type: FileType): void;
}
/**
 * An implementation of the File interface that operates on a file that is
 * completely in-memory. PreloadFiles are backed by a Uint8Array.
 *
 * @todo 'close' lever that disables functionality once closed.
 */
export declare class PreloadFile<FS extends FileSystem> extends File {
    /**
     * The file system that created the file.
     */
    protected fs: FS;
    /**
     * Path to the file
     */
    readonly path: string;
    readonly flag: string;
    readonly stats: Stats;
    protected _buffer: Uint8Array;
    protected _position: number;
    protected _dirty: boolean;
    /**
     * Creates a file with the given path and, optionally, the given contents. Note
     * that, if contents is specified, it will be mutated by the file!
     * @param _mode The mode that the file was opened using.
     *   Dictates permissions and where the file pointer starts.
     * @param stats The stats object for the given file.
     *   PreloadFile will mutate this object. Note that this object must contain
     *   the appropriate mode that the file was opened as.
     * @param buffer A buffer containing the entire
     *   contents of the file. PreloadFile will mutate this buffer. If not
     *   specified, we assume it is a new file.
     */
    constructor(
    /**
     * The file system that created the file.
     */
    fs: FS, 
    /**
     * Path to the file
     */
    path: string, flag: string, stats: Stats, _buffer?: Uint8Array);
    /**
     * Get the underlying buffer for this file. Mutating not recommended and will mess up dirty tracking.
     */
    get buffer(): Uint8Array;
    /**
     * Get the current file position.
     *
     * We emulate the following bug mentioned in the Node documentation:
     * > On Linux, positional writes don't work when the file is opened in append
     *   mode. The kernel ignores the position argument and always appends the data
     *   to the end of the file.
     * @return The current file position.
     */
    get position(): number;
    /**
     * Set the file position.
     * @param newPos new position
     */
    set position(newPos: number);
    sync(): Promise<void>;
    syncSync(): void;
    close(): Promise<void>;
    closeSync(): void;
    /**
     * Asynchronous `stat`.
     */
    stat(): Promise<Stats>;
    /**
     * Synchronous `stat`.
     */
    statSync(): Stats;
    /**
     * Asynchronous truncate.
     * @param len
     */
    truncate(len: number): Promise<void>;
    /**
     * Synchronous truncate.
     * @param len
     */
    truncateSync(len: number): void;
    /**
     * Write buffer to the file.
     * Note that it is unsafe to use fs.write multiple times on the same file
     * without waiting for the callback.
     * @param buffer Uint8Array containing the data to write to
     *  the file.
     * @param offset Offset in the buffer to start reading data from.
     * @param length The amount of bytes to write to the file.
     * @param position Offset from the beginning of the file where this
     *   data should be written. If position is null, the data will be written at
     *   the current position.
     */
    write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number>;
    /**
     * Write buffer to the file.
     * Note that it is unsafe to use fs.writeSync multiple times on the same file
     * without waiting for the callback.
     * @param buffer Uint8Array containing the data to write to
     *  the file.
     * @param offset Offset in the buffer to start reading data from.
     * @param length The amount of bytes to write to the file.
     * @param position Offset from the beginning of the file where this
     *   data should be written. If position is null, the data will be written at
     *   the current position.
     * @returns bytes written
     */
    writeSync(buffer: Uint8Array, offset?: number, length?: number, position?: number): number;
    /**
     * Read data from the file.
     * @param buffer The buffer that the data will be
     *   written to.
     * @param offset The offset within the buffer where writing will
     *   start.
     * @param length An integer specifying the number of bytes to read.
     * @param position An integer specifying where to begin reading from
     *   in the file. If position is null, data will be read from the current file
     *   position.
     */
    read<TBuffer extends ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{
        bytesRead: number;
        buffer: TBuffer;
    }>;
    /**
     * Read data from the file.
     * @param buffer The buffer that the data will be
     *   written to.
     * @param offset The offset within the buffer where writing will start.
     * @param length An integer specifying the number of bytes to read.
     * @param position An integer specifying where to begin reading from
     *   in the file. If position is null, data will be read from the current file
     *   position.
     * @returns number of bytes written
     */
    readSync(buffer: ArrayBufferView, offset?: number, length?: number, position?: number): number;
    /**
     * Asynchronous `fchmod`.
     * @param mode the mode
     */
    chmod(mode: number): Promise<void>;
    /**
     * Synchronous `fchmod`.
     * @param mode
     */
    chmodSync(mode: number): void;
    /**
     * Asynchronous `fchown`.
     * @param uid
     * @param gid
     */
    chown(uid: number, gid: number): Promise<void>;
    /**
     * Synchronous `fchown`.
     * @param uid
     * @param gid
     */
    chownSync(uid: number, gid: number): void;
    utimes(atime: Date, mtime: Date): Promise<void>;
    utimesSync(atime: Date, mtime: Date): void;
    protected isDirty(): boolean;
    /**
     * Resets the dirty bit. Should only be called after a sync has completed successfully.
     */
    protected resetDirty(): void;
    _setType(type: FileType): Promise<void>;
    _setTypeSync(type: FileType): void;
}
/**
 * For the filesystems which do not sync to anything..
 */
export declare class NoSyncFile<T extends FileSystem> extends PreloadFile<T> {
    constructor(_fs: T, _path: string, _flag: string, _stat: Stats, contents?: Uint8Array);
    /**
     * Asynchronous sync. Doesn't do anything, simply calls the cb.
     */
    sync(): Promise<void>;
    /**
     * Synchronous sync. Doesn't do anything.
     */
    syncSync(): void;
    /**
     * Asynchronous close. Doesn't do anything, simply calls the cb.
     */
    close(): Promise<void>;
    /**
     * Synchronous close. Doesn't do anything.
     */
    closeSync(): void;
}
