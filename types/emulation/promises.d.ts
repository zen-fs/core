/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { Buffer } from 'buffer';
import type * as Node from 'node:fs';
import type * as promises from 'node:fs/promises';
import type { CreateReadStreamOptions, CreateWriteStreamOptions, FileChangeInfo, FileReadResult, FlagAndOpenMode } from 'node:fs/promises';
import type { ReadableStream } from 'node:stream/web';
import type { Interface as ReadlineInterface } from 'readline';
import { FileContents } from '../filesystem';
import { BigIntStats, type BigIntStatsFs, type Stats, type StatsFs } from '../stats';
import { Dirent, type Dir } from './dir';
import type { PathLike } from './shared';
import { ReadStream, WriteStream } from './streams';
export * as constants from './constants';
export declare class FileHandle implements promises.FileHandle {
    /**
     * Gets the file descriptor for this file handle.
     */
    readonly fd: number;
    constructor(
    /**
     * Gets the file descriptor for this file handle.
     */
    fd: number);
    private get file();
    private get path();
    /**
     * Asynchronous fchown(2) - Change ownership of a file.
     */
    chown(uid: number, gid: number): Promise<void>;
    /**
     * Asynchronous fchmod(2) - Change permissions of a file.
     * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
     */
    chmod(mode: Node.Mode): Promise<void>;
    /**
     * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
     */
    datasync(): Promise<void>;
    /**
     * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
     */
    sync(): Promise<void>;
    /**
     * Asynchronous ftruncate(2) - Truncate a file to a specified length.
     * @param len If not specified, defaults to `0`.
     */
    truncate(len?: number): Promise<void>;
    /**
     * Asynchronously change file timestamps of the file.
     * @param atime The last access time. If a string is provided, it will be coerced to number.
     * @param mtime The last modified time. If a string is provided, it will be coerced to number.
     */
    utimes(atime: string | number | Date, mtime: string | number | Date): Promise<void>;
    /**
     * Asynchronously append data to a file, creating the file if it does not exist. The underlying file will _not_ be closed automatically.
     * The `FileHandle` must have been opened for appending.
     * @param data The data to write. If something other than a `Buffer` or `Uint8Array` is provided, the value is coerced to a string.
     * @param _options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
     * If `encoding` is not supplied, the default of `'utf8'` is used.
     * If `mode` is not supplied, the default of `0o666` is used.
     * If `mode` is a string, it is parsed as an octal integer.
     * If `flag` is not supplied, the default of `'a'` is used.
     */
    appendFile(data: string | Uint8Array, _options?: (Node.ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding): Promise<void>;
    /**
     * Asynchronously reads data from the file.
     * The `FileHandle` must have been opened for reading.
     * @param buffer The buffer that the data will be written to.
     * @param offset The offset in the buffer at which to start writing.
     * @param length The number of bytes to read.
     * @param position The offset from the beginning of the file from which data should be read. If `null`, data will be read from the current position.
     */
    read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<FileReadResult<TBuffer>>;
    /**
     * Asynchronously reads the entire contents of a file. The underlying file will _not_ be closed automatically.
     * The `FileHandle` must have been opened for reading.
     * @param _options An object that may contain an optional flag.
     * If a flag is not provided, it defaults to `'r'`.
     */
    readFile(_options?: {
        flag?: Node.OpenMode;
    }): Promise<Buffer>;
    readFile(_options: (Node.ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding): Promise<string>;
    /**
     * Returns a `ReadableStream` that may be used to read the files data.
     *
     * An error will be thrown if this method is called more than once or is called after the `FileHandle` is closed
     * or closing.
     *
     * While the `ReadableStream` will read the file to completion, it will not close the `FileHandle` automatically. User code must still call the `fileHandle.close()` method.
     *
     * @since v17.0.0
     * @experimental
     */
    readableWebStream(options?: promises.ReadableWebStreamOptions): ReadableStream;
    readLines(options?: promises.CreateReadStreamOptions): ReadlineInterface;
    [Symbol.asyncDispose](): Promise<void>;
    /**
     * Asynchronous fstat(2) - Get file status.
     */
    stat(opts: Node.BigIntOptions): Promise<BigIntStats>;
    stat(opts?: Node.StatOptions & {
        bigint?: false;
    }): Promise<Stats>;
    write(data: FileContents, posOrOff?: number, lenOrEnc?: BufferEncoding | number, position?: number): Promise<{
        bytesWritten: number;
        buffer: FileContents;
    }>;
    /**
     * Asynchronously writes `buffer` to the file.
     * The `FileHandle` must have been opened for writing.
     * @param buffer The buffer that the data will be written to.
     * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
     * @param length The number of bytes to write. If not supplied, defaults to `buffer.length - offset`.
     * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
     */
    write<TBuffer extends Uint8Array>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{
        bytesWritten: number;
        buffer: TBuffer;
    }>;
    /**
     * Asynchronously writes `string` to the file.
     * The `FileHandle` must have been opened for writing.
     * It is unsafe to call `write()` multiple times on the same file without waiting for the `Promise`
     * to be resolved (or rejected). For this scenario, `fs.createWriteStream` is strongly recommended.
     * @param string A string to write.
     * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
     * @param encoding The expected string encoding.
     */
    write(data: string, position?: number, encoding?: BufferEncoding): Promise<{
        bytesWritten: number;
        buffer: string;
    }>;
    /**
     * Asynchronously writes data to a file, replacing the file if it already exists. The underlying file will _not_ be closed automatically.
     * The `FileHandle` must have been opened for writing.
     * It is unsafe to call `writeFile()` multiple times on the same file without waiting for the `Promise` to be resolved (or rejected).
     * @param data The data to write. If something other than a `Buffer` or `Uint8Array` is provided, the value is coerced to a string.
     * @param _options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
     * If `encoding` is not supplied, the default of `'utf8'` is used.
     * If `mode` is not supplied, the default of `0o666` is used.
     * If `mode` is a string, it is parsed as an octal integer.
     * If `flag` is not supplied, the default of `'w'` is used.
     */
    writeFile(data: string | Uint8Array, _options?: Node.WriteFileOptions): Promise<void>;
    /**
     * Asynchronous close(2) - close a `FileHandle`.
     */
    close(): Promise<void>;
    /**
     * See `fs.writev` promisified version.
     * @todo Implement
     */
    writev(buffers: NodeJS.ArrayBufferView[], position?: number): Promise<Node.WriteVResult>;
    /**
     * See `fs.readv` promisified version.
     * @todo Implement
     */
    readv(buffers: readonly NodeJS.ArrayBufferView[], position?: number): Promise<Node.ReadVResult>;
    createReadStream(options?: CreateReadStreamOptions): ReadStream;
    createWriteStream(options?: CreateWriteStreamOptions): WriteStream;
}
/**
 * Renames a file
 * @param oldPath
 * @param newPath
 */
export declare function rename(oldPath: PathLike, newPath: PathLike): Promise<void>;
/**
 * Test whether or not the given path exists by checking with the file system.
 * @param _path
 */
export declare function exists(_path: PathLike): Promise<boolean>;
/**
 * `stat`.
 * @param path
 * @returns Stats
 */
export declare function stat(path: PathLike, options: Node.BigIntOptions): Promise<BigIntStats>;
export declare function stat(path: PathLike, options?: {
    bigint?: false;
}): Promise<Stats>;
export declare function stat(path: PathLike, options?: Node.StatOptions): Promise<Stats | BigIntStats>;
/**
 * `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 * @return
 */
export declare function lstat(path: PathLike, options?: {
    bigint?: false;
}): Promise<Stats>;
export declare function lstat(path: PathLike, options: {
    bigint: true;
}): Promise<BigIntStats>;
/**
 * `truncate`.
 * @param path
 * @param len
 */
export declare function truncate(path: PathLike, len?: number): Promise<void>;
/**
 * `unlink`.
 * @param path
 */
export declare function unlink(path: PathLike): Promise<void>;
/**
 * Asynchronous file open.
 * @see http://www.manpagez.com/man/2/open/
 * @param flags Handles the complexity of the various file modes. See its API for more details.
 * @param mode Mode to use to open the file. Can be ignored if the filesystem doesn't support permissions.
 */
export declare function open(path: PathLike, flag: string, mode?: Node.Mode): Promise<FileHandle>;
/**
 * Opens a file without resolving symlinks
 * @internal
 */
export declare function lopen(path: PathLike, flag: string, mode?: Node.Mode): Promise<FileHandle>;
/**
 * Asynchronously reads the entire contents of a file.
 * @param filename
 * @param options
 * options.encoding The string encoding for the file contents. Defaults to `null`.
 * options.flag Defaults to `'r'`.
 * @returns file data
 */
export declare function readFile(filename: PathLike, options?: {
    flag?: Node.OpenMode;
}): Promise<Buffer>;
export declare function readFile(filename: PathLike, options: (Node.EncodingOption & {
    flag?: Node.OpenMode;
}) | BufferEncoding): Promise<string>;
/**
 * Synchronously writes data to a file, replacing the file if it already exists.
 *
 * The encoding option is ignored if data is a buffer.
 * @param filename
 * @param data
 * @param _options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'w'`.
 */
export declare function writeFile(filename: PathLike, data: FileContents, _options?: Node.WriteFileOptions): Promise<void>;
/**
 * Asynchronously append data to a file, creating the file if it not yet
 * exists.
 * @param filename
 * @param data
 * @param options
 * @option options encoding Defaults to `'utf8'`.
 * @option options mode Defaults to `0644`.
 * @option options flag Defaults to `'a'`.
 */
export declare function appendFile(filename: PathLike, data: FileContents, _options?: BufferEncoding | (Node.EncodingOption & {
    mode?: Node.Mode;
    flag?: Node.OpenMode;
})): Promise<void>;
/**
 * `rmdir`.
 * @param path
 */
export declare function rmdir(path: PathLike): Promise<void>;
/**
 * `mkdir`.
 * @param path
 * @param mode defaults to `0777`
 */
export declare function mkdir(path: PathLike, mode?: Node.Mode | (Node.MakeDirectoryOptions & {
    recursive?: false;
})): Promise<void>;
export declare function mkdir(path: PathLike, mode: Node.MakeDirectoryOptions & {
    recursive: true;
}): Promise<string>;
/**
 * `readdir`. Reads the contents of a directory.
 * @param path
 */
export declare function readdir(path: PathLike, options?: (Node.EncodingOption & {
    withFileTypes?: false;
}) | BufferEncoding): Promise<string[]>;
export declare function readdir(path: PathLike, options: Node.BufferEncodingOption & {
    withFileTypes?: false;
}): Promise<Buffer[]>;
export declare function readdir(path: PathLike, options: Node.EncodingOption & {
    withFileTypes: true;
}): Promise<Dirent[]>;
/**
 * `link`.
 * @param existing
 * @param newpath
 */
export declare function link(existing: PathLike, newpath: PathLike): Promise<void>;
/**
 * `symlink`.
 * @param target target path
 * @param path link path
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 */
export declare function symlink(target: PathLike, path: PathLike, type?: Node.symlink.Type): Promise<void>;
/**
 * readlink.
 * @param path
 */
export declare function readlink(path: PathLike, options: Node.BufferEncodingOption): Promise<Buffer>;
export declare function readlink(path: PathLike, options?: Node.EncodingOption | BufferEncoding): Promise<string>;
/**
 * `chown`.
 * @param path
 * @param uid
 * @param gid
 */
export declare function chown(path: PathLike, uid: number, gid: number): Promise<void>;
/**
 * `lchown`.
 * @param path
 * @param uid
 * @param gid
 */
export declare function lchown(path: PathLike, uid: number, gid: number): Promise<void>;
/**
 * `chmod`.
 * @param path
 * @param mode
 */
export declare function chmod(path: PathLike, mode: Node.Mode): Promise<void>;
/**
 * `lchmod`.
 * @param path
 * @param mode
 */
export declare function lchmod(path: PathLike, mode: Node.Mode): Promise<void>;
/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export declare function utimes(path: PathLike, atime: string | number | Date, mtime: string | number | Date): Promise<void>;
/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 */
export declare function lutimes(path: PathLike, atime: number | Date, mtime: number | Date): Promise<void>;
/**
 * Asynchronous realpath(3) - return the canonicalized absolute pathname.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 *
 * Note: This *Can not* use doOp since doOp depends on it
 */
export declare function realpath(path: PathLike, options: Node.BufferEncodingOption): Promise<Buffer>;
export declare function realpath(path: PathLike, options?: Node.EncodingOption | BufferEncoding): Promise<string>;
/**
 * @todo Implement
 */
export declare function watch(filename: PathLike, options: (Node.WatchOptions & {
    encoding: 'buffer';
}) | 'buffer'): AsyncIterable<FileChangeInfo<Buffer>>;
export declare function watch(filename: PathLike, options?: Node.WatchOptions | BufferEncoding): AsyncIterable<FileChangeInfo<string>>;
/**
 * `access`.
 * @param path
 * @param mode
 */
export declare function access(path: PathLike, mode?: number): Promise<void>;
/**
 * @todo Implement
 */
export declare function rm(path: PathLike, options?: Node.RmOptions): Promise<void>;
/**
 * @todo Implement
 */
export declare function mkdtemp(prefix: string, options?: Node.EncodingOption): Promise<string>;
export declare function mkdtemp(prefix: string, options?: Node.BufferEncodingOption): Promise<Buffer>;
/**
 * @todo Implement
 */
export declare function copyFile(src: PathLike, dest: PathLike, mode?: number): Promise<void>;
/**
 * @todo Implement
 */
export declare function opendir(path: PathLike, options?: Node.OpenDirOptions): Promise<Dir>;
export declare function cp(source: PathLike, destination: PathLike, opts?: Node.CopyOptions): Promise<void>;
/**
 * @since v18.15.0
 * @return Fulfills with an {fs.StatFs} for the file system.
 */
export declare function statfs(path: PathLike, opts?: Node.StatFsOptions & {
    bigint?: false;
}): Promise<StatsFs>;
export declare function statfs(path: PathLike, opts: Node.StatFsOptions & {
    bigint: true;
}): Promise<BigIntStatsFs>;
export declare function statfs(path: PathLike, opts?: Node.StatFsOptions): Promise<StatsFs | BigIntStatsFs>;
