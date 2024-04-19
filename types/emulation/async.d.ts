/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import type * as Node from 'fs';
import { FileContents, NoArgCallback, ThreeArgCallback, TwoArgCallback } from '../filesystem';
import { BigIntStats, type BigIntStatsFs, type Stats, type StatsFs } from '../stats';
import { Dirent, type Dir } from './dir';
import { PathLike } from './shared';
import { ReadStream, WriteStream } from './streams';
/**
 * Asynchronous rename. No arguments other than a possible exception are given
 * to the completion callback.
 * @param oldPath
 * @param newPath
 * @param callback
 */
export declare function rename(oldPath: PathLike, newPath: PathLike, cb?: NoArgCallback): void;
/**
 * Test whether or not the given path exists by checking with the file system.
 * Then call the callback argument with either true or false.
 * @param path
 * @param callback
 * @deprecated Use {@link stat} or {@link access} instead.
 */
export declare function exists(path: PathLike, cb?: (exists: boolean) => unknown): void;
/**
 * Asynchronous `stat`.
 * @param path
 * @param callback
 */
export declare function stat(path: PathLike, callback: TwoArgCallback<Stats>): void;
export declare function stat(path: PathLike, options: Node.StatOptions & {
    bigint?: false;
}, callback: TwoArgCallback<Stats>): void;
export declare function stat(path: PathLike, options: Node.StatOptions & {
    bigint: true;
}, callback: TwoArgCallback<BigIntStats>): void;
export declare function stat(path: PathLike, options: Node.StatOptions, callback: TwoArgCallback<Stats | BigIntStats>): void;
/**
 * Asynchronous `lstat`.
 * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
 * then the link itself is stat-ed, not the file that it refers to.
 * @param path
 * @param callback
 */
export declare function lstat(path: PathLike, callback: TwoArgCallback<Stats>): void;
export declare function lstat(path: PathLike, options: Node.StatOptions & {
    bigint?: false;
}, callback: TwoArgCallback<Stats>): void;
export declare function lstat(path: PathLike, options: Node.StatOptions & {
    bigint: true;
}, callback: TwoArgCallback<BigIntStats>): void;
export declare function lstat(path: PathLike, options: Node.StatOptions, callback: TwoArgCallback<Stats | BigIntStats>): void;
/**
 * Asynchronous `truncate`.
 * @param path
 * @param len
 * @param callback
 */
export declare function truncate(path: PathLike, cb?: NoArgCallback): void;
export declare function truncate(path: PathLike, len: number, cb?: NoArgCallback): void;
/**
 * Asynchronous `unlink`.
 * @param path
 * @param callback
 */
export declare function unlink(path: PathLike, cb?: NoArgCallback): void;
/**
 * Asynchronous file open.
 * Exclusive mode ensures that path is newly created.
 *
 * `flags` can be:
 *
 * * `'r'` - Open file for reading. An exception occurs if the file does not exist.
 * * `'r+'` - Open file for reading and writing. An exception occurs if the file does not exist.
 * * `'rs'` - Open file for reading in synchronous mode. Instructs the filesystem to not cache writes.
 * * `'rs+'` - Open file for reading and writing, and opens the file in synchronous mode.
 * * `'w'` - Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
 * * `'wx'` - Like 'w' but opens the file in exclusive mode.
 * * `'w+'` - Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists).
 * * `'wx+'` - Like 'w+' but opens the file in exclusive mode.
 * * `'a'` - Open file for appending. The file is created if it does not exist.
 * * `'ax'` - Like 'a' but opens the file in exclusive mode.
 * * `'a+'` - Open file for reading and appending. The file is created if it does not exist.
 * * `'ax+'` - Like 'a+' but opens the file in exclusive mode.
 *
 * @see http://www.manpagez.com/man/2/open/
 * @param path
 * @param flags
 * @param mode defaults to `0644`
 * @param callback
 */
export declare function open(path: PathLike, flag: string, cb?: TwoArgCallback<number>): void;
export declare function open(path: PathLike, flag: string, mode: number | string, cb?: TwoArgCallback<number>): void;
/**
 * Asynchronously reads the entire contents of a file.
 * @param filename
 * @param options
 * @option options encoding The string encoding for the file contents. Defaults to `null`.
 * @option options flag Defaults to `'r'`.
 * @param callback If no encoding is specified, then the raw buffer is returned.
 */
export declare function readFile(filename: PathLike, cb: TwoArgCallback<Uint8Array>): void;
export declare function readFile(filename: PathLike, options: {
    flag?: string;
}, callback?: TwoArgCallback<Uint8Array>): void;
export declare function readFile(filename: PathLike, options: {
    encoding: BufferEncoding;
    flag?: string;
} | BufferEncoding, cb: TwoArgCallback<string>): void;
/**
 * Asynchronously writes data to a file, replacing the file if it already
 * exists.
 *
 * The encoding option is ignored if data is a buffer.
 *
 * @param filename
 * @param data
 * @param options
 * @option encoding Defaults to `'utf8'`.
 * @option mode Defaults to `0644`.
 * @option flag Defaults to `'w'`.
 * @param callback
 */
export declare function writeFile(filename: PathLike, data: FileContents, cb?: NoArgCallback): void;
export declare function writeFile(filename: PathLike, data: FileContents, encoding?: BufferEncoding, cb?: NoArgCallback): void;
export declare function writeFile(filename: PathLike, data: FileContents, options?: Node.WriteFileOptions, cb?: NoArgCallback): void;
/**
 * Asynchronously append data to a file, creating the file if it not yet
 * exists.
 *
 * @param filename
 * @param data
 * @param options
 * @option encoding Defaults to `'utf8'`.
 * @option mode Defaults to `0644`.
 * @option flag Defaults to `'a'`.
 * @param callback
 */
export declare function appendFile(filename: PathLike, data: FileContents, cb?: NoArgCallback): void;
export declare function appendFile(filename: PathLike, data: FileContents, options?: {
    encoding?: string;
    mode?: number | string;
    flag?: string;
}, cb?: NoArgCallback): void;
export declare function appendFile(filename: PathLike, data: FileContents, encoding?: string, cb?: NoArgCallback): void;
/**
 * Asynchronous `fstat`.
 * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
 * specified by the file descriptor `fd`.
 * @param fd
 * @param callback
 */
export declare function fstat(fd: number, cb: TwoArgCallback<Stats>): void;
export declare function fstat(fd: number, options: Node.StatOptions & {
    bigint?: false;
}, cb: TwoArgCallback<Stats>): void;
export declare function fstat(fd: number, options: Node.StatOptions & {
    bigint: true;
}, cb: TwoArgCallback<BigIntStats>): void;
/**
 * Asynchronous close.
 * @param fd
 * @param callback
 */
export declare function close(fd: number, cb?: NoArgCallback): void;
/**
 * Asynchronous ftruncate.
 * @param fd
 * @param len
 * @param callback
 */
export declare function ftruncate(fd: number, cb?: NoArgCallback): void;
export declare function ftruncate(fd: number, len?: number, cb?: NoArgCallback): void;
/**
 * Asynchronous fsync.
 * @param fd
 * @param callback
 */
export declare function fsync(fd: number, cb?: NoArgCallback): void;
/**
 * Asynchronous fdatasync.
 * @param fd
 * @param callback
 */
export declare function fdatasync(fd: number, cb?: NoArgCallback): void;
/**
 * Write buffer to the file specified by `fd`.
 * Note that it is unsafe to use fs.write multiple times on the same file
 * without waiting for the callback.
 * @param fd
 * @param buffer Uint8Array containing the data to write to
 *   the file.
 * @param offset Offset in the buffer to start reading data from.
 * @param length The amount of bytes to write to the file.
 * @param position Offset from the beginning of the file where this
 *   data should be written. If position is null, the data will be written at
 *   the current position.
 * @param callback The number specifies the number of bytes written into the file.
 */
export declare function write(fd: number, buffer: Uint8Array, offset: number, length: number, cb?: ThreeArgCallback<number, Uint8Array>): void;
export declare function write(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number, cb?: ThreeArgCallback<number, Uint8Array>): void;
export declare function write(fd: number, data: FileContents, cb?: ThreeArgCallback<number, string>): void;
export declare function write(fd: number, data: FileContents, position?: number, cb?: ThreeArgCallback<number, string>): void;
export declare function write(fd: number, data: FileContents, position: number | null, encoding: BufferEncoding, cb?: ThreeArgCallback<number, string>): void;
/**
 * Read data from the file specified by `fd`.
 * @param buffer The buffer that the data will be
 *   written to.
 * @param offset The offset within the buffer where writing will
 *   start.
 * @param length An integer specifying the number of bytes to read.
 * @param position An integer specifying where to begin reading from
 *   in the file. If position is null, data will be read from the current file
 *   position.
 * @param callback The number is the number of bytes read
 */
export declare function read(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number, cb?: ThreeArgCallback<number, Uint8Array>): void;
/**
 * Asynchronous `fchown`.
 * @param fd
 * @param uid
 * @param gid
 * @param callback
 */
export declare function fchown(fd: number, uid: number, gid: number, cb?: NoArgCallback): void;
/**
 * Asynchronous `fchmod`.
 * @param fd
 * @param mode
 * @param callback
 */
export declare function fchmod(fd: number, mode: string | number, cb: NoArgCallback): void;
/**
 * Change the file timestamps of a file referenced by the supplied file
 * descriptor.
 * @param fd
 * @param atime
 * @param mtime
 * @param callback
 */
export declare function futimes(fd: number, atime: number | Date, mtime: number | Date, cb?: NoArgCallback): void;
/**
 * Asynchronous `rmdir`.
 * @param path
 * @param callback
 */
export declare function rmdir(path: PathLike, cb?: NoArgCallback): void;
/**
 * Asynchronous `mkdir`.
 * @param path
 * @param mode defaults to `0777`
 * @param callback
 */
export declare function mkdir(path: PathLike, mode?: Node.Mode, cb?: NoArgCallback): void;
/**
 * Asynchronous `readdir`. Reads the contents of a directory.
 * The callback gets two arguments `(err, files)` where `files` is an array of
 * the names of the files in the directory excluding `'.'` and `'..'`.
 * @param path
 * @param callback
 */
export declare function readdir(path: PathLike, cb: TwoArgCallback<string[]>): void;
export declare function readdir(path: PathLike, options: {
    withFileTypes?: false;
}, cb: TwoArgCallback<string[]>): void;
export declare function readdir(path: PathLike, options: {
    withFileTypes: true;
}, cb: TwoArgCallback<Dirent[]>): void;
/**
 * Asynchronous `link`.
 * @param existing
 * @param newpath
 * @param callback
 */
export declare function link(existing: PathLike, newpath: PathLike, cb?: NoArgCallback): void;
/**
 * Asynchronous `symlink`.
 * @param target target path
 * @param path link path
 * @param type can be either `'dir'` or `'file'` (default is `'file'`)
 * @param callback
 */
export declare function symlink(target: PathLike, path: PathLike, cb?: NoArgCallback): void;
export declare function symlink(target: PathLike, path: PathLike, type?: Node.symlink.Type, cb?: NoArgCallback): void;
/**
 * Asynchronous readlink.
 * @param path
 * @param callback
 */
export declare function readlink(path: PathLike, callback: TwoArgCallback<string> & any): void;
export declare function readlink(path: PathLike, options: Node.BufferEncodingOption, callback: TwoArgCallback<Uint8Array>): void;
export declare function readlink(path: PathLike, options: Node.EncodingOption, callback: TwoArgCallback<string | Uint8Array>): void;
export declare function readlink(path: PathLike, options: Node.EncodingOption, callback: TwoArgCallback<string>): void;
/**
 * Asynchronous `chown`.
 * @param path
 * @param uid
 * @param gid
 * @param callback
 */
export declare function chown(path: PathLike, uid: number, gid: number, cb?: NoArgCallback): void;
/**
 * Asynchronous `lchown`.
 * @param path
 * @param uid
 * @param gid
 * @param callback
 */
export declare function lchown(path: PathLike, uid: number, gid: number, cb?: NoArgCallback): void;
/**
 * Asynchronous `chmod`.
 * @param path
 * @param mode
 * @param callback
 */
export declare function chmod(path: PathLike, mode: number | string, cb?: NoArgCallback): void;
/**
 * Asynchronous `lchmod`.
 * @param path
 * @param mode
 * @param callback
 */
export declare function lchmod(path: PathLike, mode: number | string, cb?: NoArgCallback): void;
/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 * @param callback
 */
export declare function utimes(path: PathLike, atime: number | Date, mtime: number | Date, cb?: NoArgCallback): void;
/**
 * Change file timestamps of the file referenced by the supplied path.
 * @param path
 * @param atime
 * @param mtime
 * @param callback
 */
export declare function lutimes(path: PathLike, atime: number | Date, mtime: number | Date, cb?: NoArgCallback): void;
/**
 * Asynchronous `realpath`. The callback gets two arguments
 * `(err, resolvedPath)`. May use `process.cwd` to resolve relative paths.
 *
 * @param path
 * @param callback
 */
export declare function realpath(path: PathLike, cb?: TwoArgCallback<string>): void;
export declare function realpath(path: PathLike, options: Node.EncodingOption, cb: TwoArgCallback<string>): void;
/**
 * Asynchronous `access`.
 * @param path
 * @param mode
 * @param callback
 */
export declare function access(path: PathLike, cb: NoArgCallback): void;
export declare function access(path: PathLike, mode: number, cb: NoArgCallback): void;
/**
 * @todo Implement
 */
export declare function watchFile(filename: PathLike, listener: (curr: Stats, prev: Stats) => void): void;
export declare function watchFile(filename: PathLike, options: {
    persistent?: boolean;
    interval?: number;
}, listener: (curr: Stats, prev: Stats) => void): void;
/**
 * @todo Implement
 */
export declare function unwatchFile(filename: PathLike, listener?: (curr: Stats, prev: Stats) => void): void;
/**
 * @todo Implement
 */
export declare function watch(filename: PathLike, listener?: (event: string, filename: string) => any): Node.FSWatcher;
export declare function watch(filename: PathLike, options: {
    persistent?: boolean;
}, listener?: (event: string, filename: string) => any): Node.FSWatcher;
/**
 * @todo Implement
 */
export declare function createReadStream(path: PathLike, options?: {
    flags?: string;
    encoding?: string;
    fd?: number;
    mode?: number;
    autoClose?: boolean;
}): ReadStream;
/**
 * @todo Implement
 */
export declare function createWriteStream(path: PathLike, options?: {
    flags?: string;
    encoding?: string;
    fd?: number;
    mode?: number;
}): WriteStream;
export declare function rm(path: PathLike, callback: NoArgCallback): void;
export declare function rm(path: PathLike, options: Node.RmOptions, callback: NoArgCallback): void;
/**
 * Asynchronously creates a unique temporary directory.
 * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
 */
export declare function mkdtemp(prefix: string, callback: TwoArgCallback<string>): void;
export declare function mkdtemp(prefix: string, options: Node.EncodingOption, callback: TwoArgCallback<string>): void;
export declare function mkdtemp(prefix: string, options: Node.BufferEncodingOption, callback: TwoArgCallback<Buffer>): void;
export declare function copyFile(src: PathLike, dest: PathLike, callback: NoArgCallback): void;
export declare function copyFile(src: PathLike, dest: PathLike, flags: number, callback: NoArgCallback): void;
type readvCb = ThreeArgCallback<number, NodeJS.ArrayBufferView[]>;
export declare function readv(fd: number, buffers: readonly NodeJS.ArrayBufferView[], cb: readvCb): void;
export declare function readv(fd: number, buffers: readonly NodeJS.ArrayBufferView[], position: number, cb: readvCb): void;
type writevCb = ThreeArgCallback<number, NodeJS.ArrayBufferView[]>;
export declare function writev(fd: number, buffers: NodeJS.ArrayBufferView[], cb: writevCb): void;
export declare function writev(fd: number, buffers: NodeJS.ArrayBufferView[], position: number, cb: writevCb): void;
export declare function opendir(path: PathLike, cb: TwoArgCallback<Dir>): void;
export declare function opendir(path: PathLike, options: Node.OpenDirOptions, cb: TwoArgCallback<Dir>): void;
export declare function cp(source: PathLike, destination: PathLike, callback: NoArgCallback): void;
export declare function cp(source: PathLike, destination: PathLike, opts: Node.CopyOptions, callback: NoArgCallback): void;
export declare function statfs(path: PathLike, callback: TwoArgCallback<StatsFs>): void;
export declare function statfs(path: PathLike, options: Node.StatFsOptions & {
    bigint?: false;
}, callback: TwoArgCallback<StatsFs>): void;
export declare function statfs(path: PathLike, options: Node.StatFsOptions & {
    bigint: true;
}, callback: TwoArgCallback<BigIntStatsFs>): void;
export declare function openAsBlob(path: PathLike, options?: Node.OpenAsBlobOptions): Promise<Blob>;
export {};
