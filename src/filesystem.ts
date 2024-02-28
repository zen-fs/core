/* eslint-disable @typescript-eslint/no-unused-vars */
// disable no-unused-vars since BaseFileSystem uses them a lot

import { ApiError, ErrorCode } from './ApiError.js';
import { Stats } from './stats.js';
import { File, FileFlag, ActionType } from './file.js';
import { dirname, sep, join } from './emulation/path.js';
import { Cred } from './cred.js';
import { encode } from './utils.js';

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
	 * Does the FS support synchronous operations
	 */
	synchronous: boolean;

	/**
	 * Does the FS support properties
	 */
	supportsProperties: boolean;

	/**
	 * Does the FS support links
	 */
	supportsLinks: boolean;

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
 * Structure for a filesystem. All BrowserFS FileSystems must implement this.
 *
 * This class includes some default implementations
 *
 * Assume the following about arguments passed to each API method:
 *
 * - Every path is an absolute path. `.`, `..`, and other items are resolved into an absolute form.
 * - All arguments are present. Any optional arguments at the Node API level have been passed in with their default values.
 */
export abstract class FileSystem {
	public static get Name(): string {
		return this.name;
	}

	public get metadata(): FileSystemMetadata {
		return {
			name: this.constructor.name,
			readonly: false,
			synchronous: false,
			supportsProperties: false,
			supportsLinks: false,
			totalSpace: 0,
			freeSpace: 0,
		};
	}

	constructor(options?: object) {
		// unused
	}

	abstract ready(): Promise<this>;

	// File or directory operations

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
	public abstract openFile(path: string, flag: FileFlag, cred: Cred): Promise<File>;

	/**
	 * Asynchronous file open.
	 * @see http://www.manpagez.com/man/2/open/
	 * @param flags Handles the complexity of the various file
	 *   modes. See its API for more details.
	 * @param mode Mode to use to open the file. Can be ignored if the
	 *   filesystem doesn't support permissions.
	 */
	public async open(path: string, flag: FileFlag, mode: number, cred: Cred): Promise<File> {
		try {
			switch (flag.pathExistsAction()) {
				case ActionType.THROW_EXCEPTION:
					throw ApiError.EEXIST(path);
				case ActionType.TRUNCATE_FILE:
					// NOTE: In a previous implementation, we deleted the file and
					// re-created it. However, this created a race condition if another
					// asynchronous request was trying to read the file, as the file
					// would not exist for a small period of time.
					const file = await this.openFile(path, flag, cred);
					if (!file) throw new Error('BFS has reached an impossible code path; please file a bug.');

					await file.truncate(0);
					await file.sync();
					return file;
				case ActionType.NOP:
					return this.openFile(path, flag, cred);
				default:
					throw new ApiError(ErrorCode.EINVAL, 'Invalid FileFlag object.');
			}
			// File exists.
		} catch (e) {
			// File does not exist.
			switch (flag.pathNotExistsAction()) {
				case ActionType.CREATE_FILE:
					// Ensure parent exists.
					const parentStats = await this.stat(dirname(path), cred);
					if (parentStats && !parentStats.isDirectory()) {
						throw ApiError.ENOTDIR(dirname(path));
					}
					return this.createFile(path, flag, mode, cred);
				case ActionType.THROW_EXCEPTION:
					throw ApiError.ENOENT(path);
				default:
					throw new ApiError(ErrorCode.EINVAL, 'Invalid FileFlag object.');
			}
		}
	}

	/**
	 * Opens the file at path p with the given flag. The file must exist.
	 * @param p The path to open.
	 * @param flag The flag to use when opening the file.
	 * @return A File object corresponding to the opened file.
	 */
	public abstract openFileSync(path: string, flag: FileFlag, cred: Cred): File;

	/**
	 * Synchronous file open.
	 * @see http://www.manpagez.com/man/2/open/
	 * @param flags Handles the complexity of the various file
	 *   modes. See its API for more details.
	 * @param mode Mode to use to open the file. Can be ignored if the
	 *   filesystem doesn't support permissions.
	 */
	public openSync(path: string, flag: FileFlag, mode: number, cred: Cred): File {
		// Check if the path exists, and is a file.
		let stats: Stats;
		try {
			stats = this.statSync(path, cred);
		} catch (e) {
			// File does not exist.
			switch (flag.pathNotExistsAction()) {
				case ActionType.CREATE_FILE:
					// Ensure parent exists.
					const parentStats = this.statSync(dirname(path), cred);
					if (!parentStats.isDirectory()) {
						throw ApiError.ENOTDIR(dirname(path));
					}
					return this.createFileSync(path, flag, mode, cred);
				case ActionType.THROW_EXCEPTION:
					throw ApiError.ENOENT(path);
				default:
					throw new ApiError(ErrorCode.EINVAL, 'Invalid FileFlag object.');
			}
		}
		if (!stats.hasAccess(mode, cred)) {
			throw ApiError.EACCES(path);
		}

		// File exists.
		switch (flag.pathExistsAction()) {
			case ActionType.THROW_EXCEPTION:
				throw ApiError.EEXIST(path);
			case ActionType.TRUNCATE_FILE:
				// Delete file.
				this.unlinkSync(path, cred);
				// Create file. Use the same mode as the old file.
				// Node itself modifies the ctime when this occurs, so this action
				// will preserve that behavior if the underlying file system
				// supports those properties.
				return this.createFileSync(path, flag, stats.mode, cred);
			case ActionType.NOP:
				return this.openFileSync(path, flag, cred);
			default:
				throw new ApiError(ErrorCode.EINVAL, 'Invalid FileFlag object.');
		}
	}

	/**
	 * Create the file at path p with the given mode. Then, open it with the given
	 * flag.
	 */
	public abstract createFile(path: string, flag: FileFlag, mode: number, cred: Cred): Promise<File>;

	/**
	 * Create the file at path p with the given mode. Then, open it with the given
	 * flag.
	 */
	public abstract createFileSync(path: string, flag: FileFlag, mode: number, cred: Cred): File;

	/**
	 * Asynchronous `unlink`.
	 */
	abstract unlink(path: string, cred: Cred): Promise<void>;
	/**
	 * Synchronous `unlink`.
	 */
	abstract unlinkSync(path: string, cred: Cred): void;
	// Directory operations
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
	public async exists(path: string, cred: Cred): Promise<boolean> {
		try {
			await this.stat(path, cred);
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * Test whether or not the given path exists by checking with the file system.
	 */
	public existsSync(path: string, cred: Cred): boolean {
		try {
			this.statSync(path, cred);
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * Asynchronous `realpath`.
	 *
	 * Note that the Node API will resolve `path` to an absolute path.
	 */
	public async realpath(path: string, cred: Cred): Promise<string> {
		if (this.metadata.supportsLinks) {
			// The path could contain symlinks. Split up the path,
			// resolve any symlinks, return the resolved string.
			const splitPath = path.split(sep);
			// TODO: Simpler to just pass through file, find sep and such.
			for (let i = 0; i < splitPath.length; i++) {
				const addPaths = splitPath.slice(0, i + 1);
				splitPath[i] = join(...addPaths);
			}
			return splitPath.join(sep);
		} else {
			// No symlinks. We just need to verify that it exists.
			if (!(await this.exists(path, cred))) {
				throw ApiError.ENOENT(path);
			}
			return path;
		}
	}

	/**
	 * Synchronous `realpath`.
	 *
	 * Note that the Node API will resolve `path` to an absolute path.
	 */
	public realpathSync(path: string, cred: Cred): string {
		if (this.metadata.supportsLinks) {
			// The path could contain symlinks. Split up the path,
			// resolve any symlinks, return the resolved string.
			const splitPath = path.split(sep);
			// TODO: Simpler to just pass through file, find sep and such.
			for (let i = 0; i < splitPath.length; i++) {
				const addPaths = splitPath.slice(0, i + 1);
				splitPath[i] = join(...addPaths);
			}
			return splitPath.join(sep);
		} else {
			// No symlinks. We just need to verify that it exists.
			if (this.existsSync(path, cred)) {
				return path;
			} else {
				throw ApiError.ENOENT(path);
			}
		}
	}

	/**
	 * Asynchronous `truncate`.
	 */
	public async truncate(path: string, len: number, cred: Cred): Promise<void> {
		const file = await this.open(path, FileFlag.getFileFlag('r+'), 0o644, cred);
		try {
			await file.truncate(len);
		} finally {
			await file.close();
		}
	}

	/**
	 * Synchronous `truncate`.
	 */
	public truncateSync(path: string, len: number, cred: Cred): void {
		const file = this.openSync(path, FileFlag.getFileFlag('r+'), 0o644, cred);
		// Need to safely close FD, regardless of whether or not truncate succeeds.
		try {
			file.truncateSync(len);
		} finally {
			file.closeSync();
		}
	}

	/**
	 * Asynchronously reads the entire contents of a file.
	 */
	public async readFile(fname: string, flag: FileFlag, cred: Cred): Promise<Uint8Array> {
		// Get file.
		const file = await this.open(fname, flag, 0o644, cred);
		try {
			const stat = await file.stat();
			// Allocate buffer.
			const buf = new Uint8Array(stat.size);
			await file.read(buf, 0, stat.size, 0);
			await file.close();
			return buf;
		} finally {
			await file.close();
		}
	}
	/**
	 * Synchronously reads the entire contents of a file.
	 */
	public readFileSync(fname: string, flag: FileFlag, cred: Cred): Uint8Array {
		// Get file.
		const file = this.openSync(fname, flag, 0o644, cred);
		try {
			const stat = file.statSync();
			// Allocate buffer.
			const buf = new Uint8Array(stat.size);
			file.readSync(buf, 0, stat.size, 0);
			file.closeSync();
			return buf;
		} finally {
			file.closeSync();
		}
	}

	/**
	 * Asynchronously writes data to a file, replacing the file
	 * if it already exists.
	 *
	 * The encoding option is ignored if data is a buffer.
	 */
	public async writeFile(fname: string, data: Uint8Array, flag: FileFlag, mode: number, cred: Cred): Promise<void> {
		// Get file.
		const file = await this.open(fname, flag, mode, cred);
		try {
			if (typeof data === 'string') {
				data = encode(data);
			}
			// Write into file.
			await file.write(data, 0, data.length, 0);
		} finally {
			await file.close();
		}
	}

	/**
	 * Synchronously writes data to a file, replacing the file
	 * if it already exists.
	 *
	 * The encoding option is ignored if data is a buffer.
	 */
	public writeFileSync(fname: string, data: Uint8Array, flag: FileFlag, mode: number, cred: Cred): void {
		// Get file.
		const file = this.openSync(fname, flag, mode, cred);
		try {
			if (typeof data === 'string') {
				data = encode(data);
			}
			// Write into file.
			file.writeSync(data, 0, data.length, 0);
		} finally {
			file.closeSync();
		}
	}

	/**
	 * Asynchronously append data to a file, creating the file if
	 * it not yet exists.
	 */
	public async appendFile(fname: string, data: Uint8Array, flag: FileFlag, mode: number, cred: Cred): Promise<void> {
		const file = await this.open(fname, flag, mode, cred);
		try {
			if (typeof data === 'string') {
				data = encode(data);
			}
			await file.write(data, 0, data.length, null);
		} finally {
			await file.close();
		}
	}

	/**
	 * Synchronously append data to a file, creating the file if
	 * it not yet exists.
	 */
	public appendFileSync(fname: string, data: Uint8Array, flag: FileFlag, mode: number, cred: Cred): void {
		const file = this.openSync(fname, flag, mode, cred);
		try {
			if (typeof data === 'string') {
				data = encode(data);
			}
			file.writeSync(data, 0, data.length, null);
		} finally {
			file.closeSync();
		}
	}

	/**
	 * Asynchronous `chmod`.
	 */
	public abstract chmod(path: string, mode: number, cred: Cred): Promise<void>;

	/**
	 * Synchronous `chmod`.
	 */
	public abstract chmodSync(path: string, mode: number, cred: Cred): void;

	/**
	 * Asynchronous `chown`.
	 */
	public abstract chown(path: string, uid: number, gid: number, cred: Cred): Promise<void>;

	/**
	 * Synchronous `chown`.
	 */
	public abstract chownSync(path: string, uid: number, gid: number, cred: Cred): void;

	/**
	 * Change file timestamps of the file referenced by the supplied
	 * path.
	 */
	public abstract utimes(path: string, atime: Date, mtime: Date, cred: Cred): Promise<void>;

	/**
	 * Change file timestamps of the file referenced by the supplied
	 * path.
	 */
	public abstract utimesSync(path: string, atime: Date, mtime: Date, cred: Cred): void;

	/**
	 * Asynchronous `link`.
	 */
	public abstract link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;

	/**
	 * Synchronous `link`.
	 */
	public abstract linkSync(srcpath: string, dstpath: string, cred: Cred): void;

	/**
	 * Asynchronous `symlink`.
	 * @param type can be either `'dir'` or `'file'`
	 */
	public abstract symlink(srcpath: string, dstpath: string, type: string, cred: Cred): Promise<void>;

	/**
	 * Synchronous `symlink`.
	 * @param type can be either `'dir'` or `'file'`
	 */
	public abstract symlinkSync(srcpath: string, dstpath: string, type: string, cred: Cred): void;

	/**
	 * Asynchronous readlink.
	 */
	public abstract readlink(path: string, cred: Cred): Promise<string>;

	/**
	 * Synchronous readlink.
	 */
	public abstract readlinkSync(path: string, cred: Cred): string;

	/**
	 * Synchronize the data and stats for path asynchronously
	 */
	public abstract sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;

	/**
	 * Synchronize the data and stats for path synchronously
	 */
	public abstract syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
}

/**
 * Implements the asynchronous API in terms of the synchronous API.
 */
export abstract class SyncFileSystem extends FileSystem {
	public get metadata(): FileSystemMetadata {
		return { ...super.metadata, synchronous: true };
	}

	public async ready(): Promise<this> {
		return this;
	}

	public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		return this.renameSync(oldPath, newPath, cred);
	}

	public async stat(path: string, cred: Cred): Promise<Stats> {
		return this.statSync(path, cred);
	}

	public async createFile(path: string, flag: FileFlag, mode: number, cred: Cred): Promise<File> {
		return this.createFileSync(path, flag, mode, cred);
	}

	public async open(path: string, flags: FileFlag, mode: number, cred: Cred): Promise<File> {
		return this.openSync(path, flags, mode, cred);
	}

	public async openFile(path: string, flag: FileFlag, cred: Cred): Promise<File> {
		return this.openFileSync(path, flag, cred);
	}

	public async unlink(path: string, cred: Cred): Promise<void> {
		return this.unlinkSync(path, cred);
	}

	public async rmdir(path: string, cred: Cred): Promise<void> {
		return this.rmdirSync(path, cred);
	}

	public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
		return this.mkdirSync(path, mode, cred);
	}

	public async readdir(path: string, cred: Cred): Promise<string[]> {
		return this.readdirSync(path, cred);
	}

	public async chmod(path: string, mode: number, cred: Cred): Promise<void> {
		return this.chmodSync(path, mode, cred);
	}

	public async chown(path: string, uid: number, gid: number, cred: Cred): Promise<void> {
		return this.chownSync(path, uid, gid, cred);
	}

	public async utimes(path: string, atime: Date, mtime: Date, cred: Cred): Promise<void> {
		return this.utimesSync(path, atime, mtime, cred);
	}

	public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		return this.linkSync(srcpath, dstpath, cred);
	}

	public async symlink(srcpath: string, dstpath: string, type: string, cred: Cred): Promise<void> {
		return this.symlinkSync(srcpath, dstpath, type, cred);
	}

	public async readlink(path: string, cred: Cred): Promise<string> {
		return this.readlinkSync(path, cred);
	}

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		return this.syncSync(path, data, stats);
	}
}

export abstract class AsyncFileSystem extends FileSystem {
	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public statSync(path: string, cred: Cred): Stats {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public createFileSync(path: string, flag: FileFlag, mode: number, cred: Cred): File {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public openSync(path: string, flags: FileFlag, mode: number, cred: Cred): File {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public openFileSync(path: string, flag: FileFlag, cred: Cred): File {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public unlinkSync(path: string, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public rmdirSync(path: string, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public mkdirSync(path: string, mode: number, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public readdirSync(path: string, cred: Cred): string[] {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public chmodSync(path: string, mode: number, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public chownSync(path: string, uid: number, gid: number, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public utimesSync(path: string, atime: Date, mtime: Date, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public symlinkSync(srcpath: string, dstpath: string, type: string, cred: Cred): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public readlinkSync(path: string, cred: Cred): string {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
}
