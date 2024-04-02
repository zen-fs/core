import { ApiError, ErrorCode } from './ApiError.js';
import type { Stats } from './stats.js';
import type { File } from './file.js';
import type { Cred } from './cred.js';

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
export abstract class FileSystem {
	public metadata(): FileSystemMetadata {
		return {
			name: this.constructor.name,
			readonly: false,
			synchronous: false,
			supportsProperties: false,
			totalSpace: 0,
			freeSpace: 0,
		};
	}

	/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
	public constructor(options?: object) {
		// unused
	}

	public abstract ready(): Promise<this>;

	/**
	 * Asynchronous rename. No arguments other than a possible exception
	 * are given to the completion callback.
	 */
	public abstract rename(oldPath: string, newPath: string, cred: Cred): Promise<void>;
	/**
	 * Synchronous rename.
	 */
	public abstract renameSync(oldPath: string, newPath: string, cred: Cred): void;

	/**
	 * Asynchronous `stat`.
	 */
	public abstract stat(path: string, cred: Cred): Promise<Stats>;

	/**
	 * Synchronous `stat`.
	 */
	public abstract statSync(path: string, cred: Cred): Stats;

	/**
	 * Opens the file at path p with the given flag. The file must exist.
	 * @param p The path to open.
	 * @param flag The flag to use when opening the file.
	 */
	public abstract openFile(path: string, flag: string, cred: Cred): Promise<File>;

	/**
	 * Opens the file at path p with the given flag. The file must exist.
	 * @param p The path to open.
	 * @param flag The flag to use when opening the file.
	 * @return A File object corresponding to the opened file.
	 */
	public abstract openFileSync(path: string, flag: string, cred: Cred): File;

	/**
	 * Create the file at path p with the given mode. Then, open it with the given
	 * flag.
	 */
	public abstract createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File>;

	/**
	 * Create the file at path p with the given mode. Then, open it with the given
	 * flag.
	 */
	public abstract createFileSync(path: string, flag: string, mode: number, cred: Cred): File;

	/**
	 * Asynchronous `unlink`.
	 */
	public abstract unlink(path: string, cred: Cred): Promise<void>;
	/**
	 * Synchronous `unlink`.
	 */
	public abstract unlinkSync(path: string, cred: Cred): void;
	// Directory operations
	/**
	 * Asynchronous `rmdir`.
	 */
	public abstract rmdir(path: string, cred: Cred): Promise<void>;
	/**
	 * Synchronous `rmdir`.
	 */
	public abstract rmdirSync(path: string, cred: Cred): void;
	/**
	 * Asynchronous `mkdir`.
	 * @param mode Mode to make the directory using. Can be ignored if
	 *   the filesystem doesn't support permissions.
	 */
	public abstract mkdir(path: string, mode: number, cred: Cred): Promise<void>;
	/**
	 * Synchronous `mkdir`.
	 * @param mode Mode to make the directory using. Can be ignored if
	 *   the filesystem doesn't support permissions.
	 */
	public abstract mkdirSync(path: string, mode: number, cred: Cred): void;
	/**
	 * Asynchronous `readdir`. Reads the contents of a directory.
	 *
	 * The callback gets two arguments `(err, files)` where `files` is an array of
	 * the names of the files in the directory excluding `'.'` and `'..'`.
	 */
	public abstract readdir(path: string, cred: Cred): Promise<string[]>;
	/**
	 * Synchronous `readdir`. Reads the contents of a directory.
	 */
	public abstract readdirSync(path: string, cred: Cred): string[];

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
	 * Asynchronous `link`.
	 */
	public abstract link(srcpath: string, dstpath: string, cred: Cred): Promise<void>;

	/**
	 * Synchronous `link`.
	 */
	public abstract linkSync(srcpath: string, dstpath: string, cred: Cred): void;

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
export function Sync<T extends abstract new (...args) => FileSystem>(FS: T): (abstract new (...args) => SyncFileSystem) & T {
	/**
	 * Implements the asynchronous API in terms of the synchronous API.
	 */
	abstract class _SyncFileSystem extends FS implements SyncFileSystem {
		public metadata(): FileSystemMetadata {
			return { ...super.metadata(), synchronous: true };
		}

		public async ready(): Promise<this> {
			return this;
		}

		public async exists(path: string, cred: Cred): Promise<boolean> {
			return this.existsSync(path, cred);
		}

		public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
			return this.renameSync(oldPath, newPath, cred);
		}

		public async stat(path: string, cred: Cred): Promise<Stats> {
			return this.statSync(path, cred);
		}

		public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
			return this.createFileSync(path, flag, mode, cred);
		}

		public async openFile(path: string, flag: string, cred: Cred): Promise<File> {
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

		public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
			return this.linkSync(srcpath, dstpath, cred);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			return this.syncSync(path, data, stats);
		}
	}
	return _SyncFileSystem;
}

/**
 * @internal
 */
declare abstract class AsyncFileSystem {
	metadata(): FileSystemMetadata;
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

export function Async<T extends abstract new (...args) => FileSystem>(FS: T): (abstract new (...args) => AsyncFileSystem) & T {
	abstract class _AsyncFileSystem extends FS implements AsyncFileSystem {
		public metadata(): FileSystemMetadata {
			return { ...super.metadata(), synchronous: false };
		}
		/* eslint-disable @typescript-eslint/no-unused-vars */
		public renameSync(oldPath: string, newPath: string, cred: Cred): void {
			throw new ApiError(ErrorCode.ENOTSUP);
		}

		public statSync(path: string, cred: Cred): Stats {
			throw new ApiError(ErrorCode.ENOTSUP);
		}

		public createFileSync(path: string, flag: string, mode: number, cred: Cred): File {
			throw new ApiError(ErrorCode.ENOTSUP);
		}

		public openFileSync(path: string, flag: string, cred: Cred): File {
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

		public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
			throw new ApiError(ErrorCode.ENOTSUP);
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			throw new ApiError(ErrorCode.ENOTSUP);
		}
	}
	/* eslint-enable @typescript-eslint/no-unused-vars */
	return _AsyncFileSystem;
}

/**
 * @internal
 */
declare abstract class ReadonlyFileSystem {
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

export function Readonly<T extends abstract new (...args) => FileSystem>(FS: T): (abstract new (...args) => ReadonlyFileSystem) & T {
	abstract class _ReadonlyFileSystem extends FS implements ReadonlyFileSystem {
		public metadata(): FileSystemMetadata {
			return { ...super.metadata(), readonly: true };
		}
		/* eslint-disable @typescript-eslint/no-unused-vars */
		public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
			throw new ApiError(ErrorCode.EROFS);
		}

		public renameSync(oldPath: string, newPath: string, cred: Cred): void {
			throw new ApiError(ErrorCode.EROFS);
		}

		public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
			throw new ApiError(ErrorCode.EROFS);
		}

		public createFileSync(path: string, flag: string, mode: number, cred: Cred): File {
			throw new ApiError(ErrorCode.EROFS);
		}

		public async unlink(path: string, cred: Cred): Promise<void> {
			throw new ApiError(ErrorCode.EROFS);
		}

		public unlinkSync(path: string, cred: Cred): void {
			throw new ApiError(ErrorCode.EROFS);
		}

		public async rmdir(path: string, cred: Cred): Promise<void> {
			throw new ApiError(ErrorCode.EROFS);
		}

		public rmdirSync(path: string, cred: Cred): void {
			throw new ApiError(ErrorCode.EROFS);
		}

		public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
			throw new ApiError(ErrorCode.EROFS);
		}

		public mkdirSync(path: string, mode: number, cred: Cred): void {
			throw new ApiError(ErrorCode.EROFS);
		}

		public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
			throw new ApiError(ErrorCode.EROFS);
		}

		public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
			throw new ApiError(ErrorCode.EROFS);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			throw new ApiError(ErrorCode.EROFS);
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			throw new ApiError(ErrorCode.EROFS);
		}
		/* eslint-enable @typescript-eslint/no-unused-vars */
	}
	return _ReadonlyFileSystem;
}
