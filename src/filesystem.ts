import type { ExtractProperties } from 'utilium';
import { ErrnoError, Errno } from './error.js';
import { rootCred, type Cred } from './cred.js';
import { join } from './emulation/path.js';
import { PreloadFile, parseFlag, type File } from './file.js';
import type { Stats } from './stats.js';

export type FileContents = ArrayBufferView | string;

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
	 * The total space
	 */
	totalSpace: number;

	/**
	 * The available space
	 */
	freeSpace: number;

	/**
	 * If set, disables File from using a resizable array buffer.
	 */
	disableResizableBuffers: boolean;
}

/**
 * Structure for a filesystem. All ZenFS backends must extend this.
 *
 * This class includes some default implementations
 *
 * Assume the following about arguments passed to each API method:
 *
 * - Every path is an absolute path. `.`, `..`, and other items are resolved into an absolute form.
 * - All arguments are present. Any optional arguments at the Node API level have been passed in with their default values.
 */
export abstract class FileSystem {
	/**
	 * Get metadata about the current file syste,
	 */
	public metadata(): FileSystemMetadata {
		return {
			name: this.constructor.name,
			readonly: false,
			totalSpace: 0,
			freeSpace: 0,
			disableResizableBuffers: false,
		};
	}

	public constructor(options?: object) {
		// unused
	}

	public async ready(): Promise<void> {}

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
declare abstract class SyncFS extends FileSystem {
	metadata(): FileSystemMetadata;
	ready(): Promise<void>;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Sync<T extends abstract new (...args: any[]) => FileSystem>(FS: T): (abstract new (...args: any[]) => SyncFS) & T {
	abstract class _SyncFS extends FS implements SyncFS {
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
	return _SyncFS;
}

/**
 * @internal
 */
declare abstract class AsyncFS extends FileSystem {
	/**
	 * @hidden
	 */
	abstract _sync: FileSystem;
	queueDone(): Promise<void>;
	metadata(): FileSystemMetadata;
	ready(): Promise<void>;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncMethods = ExtractProperties<FileSystem, (...args: any[]) => Promise<unknown>>;

/**
 * @internal
 */
type AsyncOperation = {
	[K in keyof AsyncMethods]: [K, ...Parameters<FileSystem[K]>];
}[keyof AsyncMethods];

/**
 * Async() implements synchronous methods on an asynchronous file system
 *
 * Implementing classes must define a protected _sync property for the synchronous file system used as a cache.
 * by:
 *
 * - Performing operations over the in-memory copy, while asynchronously pipelining them
 *   to the backing store.
 * - During application loading, the contents of the async file system can be reloaded into
 *   the synchronous store, if desired.
 *
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Async<T extends abstract new (...args: any[]) => FileSystem>(FS: T): (abstract new (...args: any[]) => AsyncFS) & T {
	abstract class _AsyncFS extends FS implements AsyncFS {
		/**
		 * Queue of pending asynchronous operations.
		 */
		private _queue: AsyncOperation[] = [];
		private get _queueRunning(): boolean {
			return !!this._queue.length;
		}

		public queueDone(): Promise<void> {
			return new Promise(resolve => {
				const check = (): unknown => (this._queueRunning ? setTimeout(check) : resolve());
				check();
			});
		}

		private _isInitialized: boolean = false;

		abstract _sync: FileSystem;

		public async ready(): Promise<void> {
			await this._sync.ready();
			await super.ready();
			if (this._isInitialized) {
				return;
			}

			try {
				await this.crossCopy('/');
				this._isInitialized = true;
			} catch (e) {
				this._isInitialized = false;
				throw e;
			}
		}

		public renameSync(oldPath: string, newPath: string, cred: Cred): void {
			this._sync.renameSync(oldPath, newPath, cred);
			this.queue('rename', oldPath, newPath, cred);
		}

		public statSync(path: string, cred: Cred): Stats {
			return this._sync.statSync(path, cred);
		}

		public createFileSync(path: string, flag: string, mode: number, cred: Cred): PreloadFile<this> {
			this._sync.createFileSync(path, flag, mode, cred);
			this.queue('createFile', path, flag, mode, cred);
			return this.openFileSync(path, flag, cred);
		}

		public openFileSync(path: string, flag: string, cred: Cred): PreloadFile<this> {
			const file = this._sync.openFileSync(path, flag, cred);
			const stats = file.statSync();
			const buffer = new Uint8Array(stats.size);
			file.readSync(buffer);
			return new PreloadFile(this, path, flag, stats, buffer);
		}

		public unlinkSync(path: string, cred: Cred): void {
			this._sync.unlinkSync(path, cred);
			this.queue('unlink', path, cred);
		}

		public rmdirSync(path: string, cred: Cred): void {
			this._sync.rmdirSync(path, cred);
			this.queue('rmdir', path, cred);
		}

		public mkdirSync(path: string, mode: number, cred: Cred): void {
			this._sync.mkdirSync(path, mode, cred);
			this.queue('mkdir', path, mode, cred);
		}

		public readdirSync(path: string, cred: Cred): string[] {
			return this._sync.readdirSync(path, cred);
		}

		public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
			this._sync.linkSync(srcpath, dstpath, cred);
			this.queue('link', srcpath, dstpath, cred);
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			this._sync.syncSync(path, data, stats);
			this.queue('sync', path, data, stats);
		}

		public existsSync(path: string, cred: Cred): boolean {
			return this._sync.existsSync(path, cred);
		}

		/**
		 * @internal
		 */
		protected async crossCopy(path: string): Promise<void> {
			const stats = await this.stat(path, rootCred);
			if (stats.isDirectory()) {
				if (path !== '/') {
					const stats = await this.stat(path, rootCred);
					this._sync.mkdirSync(path, stats.mode, stats.cred());
				}
				const files = await this.readdir(path, rootCred);
				for (const file of files) {
					await this.crossCopy(join(path, file));
				}
			} else {
				const asyncFile = await this.openFile(path, parseFlag('r'), rootCred);
				const syncFile = this._sync.createFileSync(path, parseFlag('w'), stats.mode, stats.cred());
				try {
					const buffer = new Uint8Array(stats.size);
					await asyncFile.read(buffer);
					syncFile.writeSync(buffer, 0, stats.size);
				} finally {
					await asyncFile.close();
					syncFile.closeSync();
				}
			}
		}

		/**
		 * @internal
		 */
		private async _next(): Promise<void> {
			if (!this._queueRunning) {
				return;
			}

			const [method, ...args] = this._queue.shift()!;
			// @ts-expect-error 2556 (since ...args is not correctly picked up as being a tuple)
			await this[method](...args);
			await this._next();
		}

		/**
		 * @internal
		 */
		private queue(...op: AsyncOperation) {
			this._queue.push(op);
			this._next();
		}
	}

	return _AsyncFS;
}

/**
 * @internal
 */
declare abstract class ReadonlyFS extends FileSystem {
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

/**
 * Implements the non-readonly methods to throw `EROFS`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Readonly<T extends abstract new (...args: any[]) => FileSystem>(FS: T): (abstract new (...args: any[]) => ReadonlyFS) & T {
	abstract class _ReadonlyFS extends FS implements ReadonlyFS {
		public metadata(): FileSystemMetadata {
			return { ...super.metadata(), readonly: true };
		}
		/* eslint-disable @typescript-eslint/no-unused-vars */
		public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public renameSync(oldPath: string, newPath: string, cred: Cred): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
			throw new ErrnoError(Errno.EROFS);
		}

		public createFileSync(path: string, flag: string, mode: number, cred: Cred): File {
			throw new ErrnoError(Errno.EROFS);
		}

		public async unlink(path: string, cred: Cred): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public unlinkSync(path: string, cred: Cred): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async rmdir(path: string, cred: Cred): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public rmdirSync(path: string, cred: Cred): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public mkdirSync(path: string, mode: number, cred: Cred): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
			throw new ErrnoError(Errno.EROFS);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			throw new ErrnoError(Errno.EROFS);
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			throw new ErrnoError(Errno.EROFS);
		}
		/* eslint-enable @typescript-eslint/no-unused-vars */
	}
	return _ReadonlyFS;
}
