import type { ErrnoError } from './error.js';
import type { File } from './file.js';
import { ZenFsType, type Stats } from './stats.js';

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
	 * Whether the FS is readonly or not
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
	 * @default false
	 */
	noResizableBuffers: boolean;

	/**
	 * If set, disables caching on async file systems.
	 * This means *sync operations will not work*.
	 * It has no affect on sync file systems.
	 * @default false
	 */
	noAsyncCache: boolean;

	/**
	 * The optimal block size to use with the file system
	 * @default 4096
	 */
	blockSize?: number;

	/**
	 * Total number of (file) nodes available
	 */
	totalNodes?: number;

	/**
	 * Number of free (file) nodes available
	 */
	freeNodes?: number;

	/**
	 * The type of the FS
	 */
	type: number;
}

/**
 * Structure for a filesystem. All ZenFS backends must extend this.
 *
 * This class includes default implementations for `exists` and `existsSync`
 *
 * If you are extending this class, note that every path is an absolute path and all arguments are present.
 */
export abstract class FileSystem {
	/**
	 * Get metadata about the current file system
	 */
	public metadata(): FileSystemMetadata {
		return {
			name: this.constructor.name.toLowerCase(),
			readonly: false,
			totalSpace: 0,
			freeSpace: 0,
			noResizableBuffers: false,
			noAsyncCache: this._disableSync ?? false,
			type: ZenFsType,
		};
	}

	/**
	 * Whether the sync cache should be disabled.
	 * Only affects async things.
	 * @internal @protected
	 */
	_disableSync?: boolean;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
	public constructor(...args: any[]) {}

	public async ready(): Promise<void> {}

	/**
	 * Asynchronous rename.
	 */
	public abstract rename(oldPath: string, newPath: string): Promise<void>;
	/**
	 * Synchronous rename.
	 */
	public abstract renameSync(oldPath: string, newPath: string): void;

	/**
	 * Asynchronous `stat`.
	 */
	public abstract stat(path: string): Promise<Stats>;

	/**
	 * Synchronous `stat`.
	 */
	public abstract statSync(path: string): Stats;

	/**
	 * Opens the file at `path` with the given flag. The file must exist.
	 * @param path The path to open.
	 * @param flag The flag to use when opening the file.
	 */
	public abstract openFile(path: string, flag: string): Promise<File>;

	/**
	 * Opens the file at `path` with the given flag. The file must exist.
	 * @param path The path to open.
	 * @param flag The flag to use when opening the file.
	 * @return A File object corresponding to the opened file.
	 */
	public abstract openFileSync(path: string, flag: string): File;

	/**
	 * Create the file at `path` with the given mode. Then, open it with the given flag.
	 */
	public abstract createFile(path: string, flag: string, mode: number): Promise<File>;

	/**
	 * Create the file at `path` with the given mode. Then, open it with the given flag.
	 */
	public abstract createFileSync(path: string, flag: string, mode: number): File;

	/**
	 * Asynchronous `unlink`.
	 */
	public abstract unlink(path: string): Promise<void>;
	/**
	 * Synchronous `unlink`.
	 */
	public abstract unlinkSync(path: string): void;
	// Directory operations
	/**
	 * Asynchronous `rmdir`.
	 */
	public abstract rmdir(path: string): Promise<void>;
	/**
	 * Synchronous `rmdir`.
	 */
	public abstract rmdirSync(path: string): void;
	/**
	 * Asynchronous `mkdir`.
	 * @param mode Mode to make the directory using.
	 */
	public abstract mkdir(path: string, mode: number): Promise<void>;
	/**
	 * Synchronous `mkdir`.
	 * @param mode Mode to make the directory using.
	 */
	public abstract mkdirSync(path: string, mode: number): void;
	/**
	 * Asynchronous `readdir`. Reads the contents of a directory.
	 */
	public abstract readdir(path: string): Promise<string[]>;
	/**
	 * Synchronous `readdir`. Reads the contents of a directory.
	 */
	public abstract readdirSync(path: string): string[];

	/**
	 * Test whether or not the given path exists.
	 */
	public async exists(path: string): Promise<boolean> {
		try {
			await this.stat(path);
			return true;
		} catch (e) {
			return (e as ErrnoError).code != 'ENOENT';
		}
	}

	/**
	 * Test whether or not the given path exists.
	 */
	public existsSync(path: string): boolean {
		try {
			this.statSync(path);
			return true;
		} catch (e) {
			return (e as ErrnoError).code != 'ENOENT';
		}
	}

	/**
	 * Asynchronous `link`.
	 */
	public abstract link(target: string, link: string): Promise<void>;

	/**
	 * Synchronous `link`.
	 */
	public abstract linkSync(target: string, link: string): void;

	/**
	 * Synchronize the data and stats for path asynchronously
	 */
	public abstract sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;

	/**
	 * Synchronize the data and stats for path synchronously
	 */
	public abstract syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
}
