import type { ErrnoError } from './error.js';
import type { File } from './file.js';
import type { Stats } from './stats.js';
import { ZenFsType } from './stats.js';

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

	/**
	 * Various features the file system supports.
	 * These are used by the VFS for optimizations.
	 * - setid:	The FS supports setuid and setgid when creating files and directories.
	 */
	features?: ('setid' | '')[];
}

/**
 * Options used when creating files and directories.
 * This weird naming and such is to preserve backward compatibility.
 * @todo [BREAKING] Move the `mode` parameter of `createFile` and `mkdir` into this
 * @internal
 */
export interface CreationOptions {
	/**
	 * The uid to create the file.
	 * This is ignored if the FS supports setuid and the setuid bit is set
	 */
	uid: number;

	/**
	 * The gid to create the file.
	 * This is ignored if the FS supports setgid and the setgid bit is set
	 */
	gid: number;

	/**
	 * The mode to create the file with.
	 */
	mode?: number;
}

/**
 * This is the correct type that will be used when the API is updated in a breaking release
 */
export interface PureCreationOptions extends CreationOptions {
	/**
	 * The mode to create the file with.
	 */
	mode: number;
}

/**
 * Provides a consistent and easy to use internal API.
 * Default implementations for `exists` and `existsSync` are included.
 * If you are extending this class, note that every path is an absolute path and all arguments are present.
 * @internal
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
			features: [],
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

	public abstract rename(oldPath: string, newPath: string): Promise<void>;
	public abstract renameSync(oldPath: string, newPath: string): void;

	public abstract stat(path: string): Promise<Stats>;
	public abstract statSync(path: string): Stats;

	/**
	 * Opens the file at `path` with `flag`. The file must exist.
	 * @param path The path to open.
	 * @param flag The flag to use when opening the file.
	 */
	public abstract openFile(path: string, flag: string): Promise<File>;

	/**
	 * Opens the file at `path` with `flag`. The file must exist.
	 * @param path The path to open.
	 * @param flag The flag to use when opening the file.
	 */
	public abstract openFileSync(path: string, flag: string): File;

	/**
	 * Create the file at `path` with the given options. Then, open it with `flag`.
	 */
	public abstract createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File>;

	/**
	 * Create the file at `path` with the given options. Then, open it with `flag`.
	 */
	public abstract createFileSync(path: string, flag: string, mode: number, options: CreationOptions): File;

	public abstract unlink(path: string): Promise<void>;
	public abstract unlinkSync(path: string): void;

	// Directory operations

	public abstract rmdir(path: string): Promise<void>;
	public abstract rmdirSync(path: string): void;

	public abstract mkdir(path: string, mode: number, options: CreationOptions): Promise<void>;
	public abstract mkdirSync(path: string, mode: number, options: CreationOptions): void;

	public abstract readdir(path: string): Promise<string[]>;
	public abstract readdirSync(path: string): string[];

	/**
	 * Test whether or not `path` exists.
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
	 * Test whether or not `path` exists.
	 */
	public existsSync(path: string): boolean {
		try {
			this.statSync(path);
			return true;
		} catch (e) {
			return (e as ErrnoError).code != 'ENOENT';
		}
	}

	public abstract link(target: string, link: string): Promise<void>;
	public abstract linkSync(target: string, link: string): void;

	public abstract sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void>;
	public abstract syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
}
