import type { ConstMap } from 'utilium';
import type { StatsLike } from '../vfs/stats.js';
import type { ErrnoError } from './error.js';
import type { File } from './file.js';
import type { InodeLike } from './inode.js';

/**
 * Usage information about a file system
 * @category Internals
 * @internal
 */
export interface UsageInfo {
	/**
	 * The total space
	 */
	totalSpace: number;

	/**
	 * The available space
	 */
	freeSpace: number;

	/**
	 * The optimal block size to use with the file system
	 * @default 4096
	 */
	blockSize?: number;

	/**
	 * Total number of nodes available
	 */
	totalNodes?: number;

	/**
	 * Number of free nodes available
	 */
	freeNodes?: number;
}

/* node:coverage disable */
/**
 * Metadata about a FileSystem
 * @category Internals
 * @deprecated
 */
export interface FileSystemMetadata extends UsageInfo {
	/**
	 * The name of the FS
	 * @deprecated Use `FileSystem#name`
	 */
	name: string;

	/**
	 * Whether the FS is readonly or not
	 * @deprecated Use `FileSystem#attributes
	 */
	readonly: boolean;

	/**
	 * If set, disables File from using a resizable array buffer.
	 * @default false
	 * @deprecated Use `FileSystem#attributes`
	 */
	noResizableBuffers: boolean;

	/**
	 * If set, disables caching on async file systems.
	 * This means *sync operations will not work*.
	 * It has no affect on sync file systems.
	 * @default false
	 * @deprecated Use `FileSystem#attributes
	 */
	noAsyncCache: boolean;

	/**
	 * The type of the FS
	 */
	type: number;

	/**
	 * Various features the file system supports.
	 * @deprecated Use `FileSystem#attributes`
	 */
	features?: unknown[];
}
/* node:coverage enable */

/**
 * Attributes that control how the file system interacts with the VFS.
 * No options are set by default.
 * @category Internals
 * @internal
 */
export type FileSystemAttributes = {
	/** The FS supports setuid and setgid when creating files and directories. */
	setid: void;

	/** If set, disables `PreloadFile` from using a resizable array buffer. */
	no_buffer_resize: void;

	/**
	 * If set disables async file systems from preloading their contents.
	 * This means *sync operations will not work* (unless the contents are cached)
	 * It has no affect on sync file systems.
	 */
	no_async: void;

	/**
	 * Currently unused. In the future, this will disable caching.
	 * Not recommended due to performance impact.
	 */
	no_cache: void;

	/**
	 * If set, the file system should not be written to.
	 * This should be set for read-only file systems.
	 */
	no_write: void;

	/**
	 * The FS is using the default implementation for `streamRead`
	 * @internal
	 */
	default_stream_read: void;

	/**
	 * The FS is using the default implementation for `streamWrite`
	 * @internal
	 */
	default_stream_write: void;
};

/**
 * Options used when creating files and directories.
 * This weird naming and such is to preserve backward compatibility.
 * @todo [BREAKING] Move the `mode` parameter of `createFile` and `mkdir` into this
 * @category Internals
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
 * @category Internals
 * @internal
 */
export interface PureCreationOptions extends CreationOptions {
	/**
	 * The mode to create the file with.
	 */
	mode: number;
}

/**
 * @internal
 */
export interface StreamOptions {
	start?: number;

	end?: number;
}

const _chunkSize = 0x1000;

/**
 * Provides a consistent and easy to use internal API.
 * Default implementations for `exists` and `existsSync` are included.
 * If you are extending this class, note that every path is an absolute path and all arguments are present.
 * @category Internals
 * @internal
 */
export abstract class FileSystem {
	public label?: string;

	/**
	 * The last place this file system was mounted
	 * @internal @protected
	 */
	_mountPoint?: string;

	/**
	 * @see FileSystemAttributes
	 */
	public readonly attributes = new Map() as ConstMap<FileSystemAttributes> & Map<string, any>;

	public constructor(
		/**
		 * A unique ID for this kind of file system.
		 * Currently unused internally, but could be used for partition tables or something
		 */
		public readonly id: number,

		/**
		 * The name for this file system.
		 * For example, tmpfs for an in memory one
		 */
		public readonly name: string
	) {
		if (this.streamRead === FileSystem.prototype.streamRead) this.attributes.set('default_stream_read');
		if (this.streamWrite === FileSystem.prototype.streamWrite) this.attributes.set('default_stream_write');
	}

	public toString(): string {
		return `${this.name} ${this.label ?? ''} (${this._mountPoint ? 'mounted on ' + this._mountPoint : 'unmounted'})`;
	}

	/**
	 * Default implementation.
	 * @todo Implement
	 * @experimental
	 */
	public usage(): UsageInfo {
		return {
			totalSpace: 0,
			freeSpace: 0,
		};
	}

	/* node:coverage disable */
	/**
	 * Get metadata about the current file system
	 * @deprecated
	 */
	public metadata(): FileSystemMetadata {
		return {
			...this.usage(),
			name: this.name,
			readonly: this.attributes.has('no_write'),
			noResizableBuffers: this.attributes.has('no_buffer_resize'),
			noAsyncCache: this.attributes.has('no_async'),
			features: Array.from(this.attributes.keys()),
			type: this.id,
		};
	}
	/* node:coverage enable */

	public async ready(): Promise<void> {}

	public abstract rename(oldPath: string, newPath: string): Promise<void>;
	public abstract renameSync(oldPath: string, newPath: string): void;

	public abstract stat(path: string): Promise<InodeLike>;
	public abstract statSync(path: string): InodeLike;

	/** Modify metadata. */
	public abstract touch(path: string, metadata: Partial<InodeLike>): Promise<void>;

	/** Modify metadata. */
	public abstract touchSync(path: string, metadata: Partial<InodeLike>): void;

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

	public abstract sync(path: string, data?: Uint8Array, stats?: Readonly<Partial<StatsLike>>): Promise<void>;
	public abstract syncSync(path: string, data?: Uint8Array, stats?: Readonly<Partial<StatsLike>>): void;

	/**
	 * Reads into a buffer
	 * @param buffer The buffer to read into. You must set the `byteOffset` and `byteLength` appropriately!
	 * @param offset The offset into the file to start reading from
	 * @param end The position in the file to stop reading
	 */
	public abstract read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void>;
	/**
	 * Reads into a buffer
	 * @param buffer The buffer to read into. You must set the `byteOffset` and `byteLength` appropriately!
	 * @param offset The offset into the file to start reading from
	 * @param end The position in the file to stop reading
	 */
	public abstract readSync(path: string, buffer: Uint8Array, offset: number, end: number): void;

	/**
	 * Writes a buffer to a file
	 * @param buffer The buffer to write. You must set the `byteOffset` and `byteLength` appropriately!
	 * @param offset The offset in the file to start writing
	 */
	public abstract write(path: string, buffer: Uint8Array, offset: number): Promise<void>;

	/**
	 * Writes a buffer to a file
	 * @param buffer The buffer to write. You must set the `byteOffset` and `byteLength` appropriately!
	 * @param offset The offset in the file to start writing
	 */
	public abstract writeSync(path: string, buffer: Uint8Array, offset: number): void;

	/**
	 * Read a file using a stream.
	 * @privateRemarks The default implementation of `streamRead` uses "chunked" `read`s
	 */
	public streamRead(path: string, options: StreamOptions): ReadableStream {
		return new ReadableStream({
			start: async controller => {
				const { size } = await this.stat(path);
				const { start = 0, end = size } = options;

				for (let offset = start; offset < end; offset += _chunkSize) {
					const bytesRead = offset + _chunkSize > end ? end - offset : _chunkSize;
					const buffer = new Uint8Array(bytesRead);
					await this.read(path, buffer, offset, offset + bytesRead).catch(controller.error.bind(controller));
					controller.enqueue(buffer);
				}

				controller.close();
			},
			type: 'bytes',
		});
	}

	/**
	 * Write a file using stream.
	 * @privateRemarks The default implementation of `streamWrite` uses "chunked" `write`s
	 */
	public streamWrite(path: string, options: StreamOptions): WritableStream {
		let position = options.start ?? 0;
		return new WritableStream<Uint8Array>({
			write: async (chunk, controller) => {
				await this.write(path, chunk, position).catch(controller.error.bind(controller));
				position += chunk.byteLength;
			},
		});
	}
}
