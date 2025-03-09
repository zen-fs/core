import type * as fs from 'node:fs';
import type { Errno } from '../internal/error.js';
import { ErrnoError } from '../internal/error.js';
import type { CreationOptions, UsageInfo } from '../internal/filesystem.js';
import { FileSystem } from '../internal/filesystem.js';
import { isDirectory, type InodeLike } from '../internal/inode.js';
import { resolve } from '../path.js';
import type { Backend } from './backend.js';
import { warn } from '../internal/log.js';

// Type for Node.js fs module
export type NodeFS = typeof fs;

/**
 * Passthrough backend options
 * @category Backends and Configuration
 */
export interface PassthroughOptions {
	fs: NodeFS;
	prefix: string;
}

export class PassthroughFS extends FileSystem {
	public constructor(
		public readonly nodeFS: NodeFS,
		public readonly prefix: string
	) {
		super(0x6e6f6465, 'nodefs');
	}

	public usage(): UsageInfo {
		const info = this.nodeFS.statfsSync(this.prefix);
		return {
			totalSpace: info.bsize * info.blocks,
			freeSpace: info.bsize * info.bfree,
		};
	}

	public path(path: string): string {
		return this.prefix + path;
	}

	public error(err: unknown, path: string): never {
		const error = err as NodeJS.ErrnoException;
		throw ErrnoError.With(error.code as keyof typeof Errno, path, error.syscall);
	}

	/**
	 * Rename a file or directory.
	 */
	public async rename(oldPath: string, newPath: string): Promise<void> {
		try {
			await this.nodeFS.promises.rename(this.path(oldPath), this.path(newPath));
		} catch (err) {
			this.error(err, oldPath);
		}
	}

	/**
	 * Rename a file or directory synchronously.
	 */
	public renameSync(oldPath: string, newPath: string): void {
		try {
			this.nodeFS.renameSync(this.path(oldPath), this.path(newPath));
		} catch (err) {
			this.error(err, oldPath);
		}
	}

	/**
	 * Get file statistics.
	 */
	public async stat(path: string): Promise<InodeLike> {
		try {
			return await this.nodeFS.promises.stat(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Get file statistics synchronously.
	 */
	public statSync(path: string): InodeLike {
		try {
			return this.nodeFS.statSync(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	public async touch(path: string, metadata: InodeLike): Promise<void> {
		try {
			await using handle = await this.nodeFS.promises.open(this.path(path), 'w');
			await handle.chmod(metadata.mode);
			await handle.chown(metadata.uid, metadata.gid);
			await handle.utimes(metadata.atimeMs, metadata.mtimeMs);
		} catch (err) {
			this.error(err, path);
		}
	}

	public touchSync(path: string, metadata: InodeLike): void {
		try {
			this.nodeFS.chmodSync(this.path(path), metadata.mode);
			this.nodeFS.chownSync(this.path(path), metadata.uid, metadata.gid);
			this.nodeFS.utimesSync(this.path(path), metadata.atimeMs, metadata.mtimeMs);
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Unlink (delete) a file.
	 */
	public async unlink(path: string): Promise<void> {
		try {
			await this.nodeFS.promises.unlink(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Unlink (delete) a file synchronously.
	 */
	public unlinkSync(path: string): void {
		try {
			this.nodeFS.unlinkSync(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Create a directory.
	 */
	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		try {
			await this.nodeFS.promises.mkdir(this.path(path), options);
			return await this.nodeFS.promises.stat(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Create a directory synchronously.
	 */
	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		try {
			this.nodeFS.mkdirSync(this.path(path), options);
			return this.nodeFS.statSync(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Read the contents of a directory.
	 */
	public async readdir(path: string): Promise<string[]> {
		try {
			return await this.nodeFS.promises.readdir(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Read the contents of a directory synchronously.
	 */
	public readdirSync(path: string): string[] {
		try {
			return this.nodeFS.readdirSync(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Create a file.
	 */
	public async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		try {
			if (isDirectory(options)) {
				await this.nodeFS.promises.mkdir(this.path(path), { mode: options.mode });
			} else {
				await using handle = await this.nodeFS.promises.open(this.path(path), 'wx');
				await handle.close();
			}

			return await this.nodeFS.promises.stat(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Create a file synchronously.
	 */
	public createFileSync(path: string, options: CreationOptions): InodeLike {
		try {
			if (isDirectory(options)) {
				this.nodeFS.mkdirSync(this.path(path), { mode: options.mode });
			} else {
				const fd = this.nodeFS.openSync(this.path(path), 'wx');
				this.nodeFS.closeSync(fd);
			}
			return this.nodeFS.statSync(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Remove a directory.
	 */
	public async rmdir(path: string): Promise<void> {
		try {
			await this.nodeFS.promises.rmdir(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Remove a directory synchronously.
	 */
	public rmdirSync(path: string): void {
		try {
			this.nodeFS.rmdirSync(this.path(path));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Synchronize data to the file system.
	 */
	public async sync(path: string): Promise<void> {
		warn('Sync on passthrough is unnecessary');
	}

	/**
	 * Synchronize data to the file system synchronously.
	 */
	public syncSync(path: string): void {
		warn('Sync on passthrough is unnecessary');
	}

	/**
	 * Create a hard link.
	 */
	public async link(target: string, link: string): Promise<void> {
		try {
			await this.nodeFS.promises.link(this.path(target), this.path(link));
		} catch (err) {
			this.error(err, target);
		}
	}

	/**
	 * Create a hard link synchronously.
	 */
	public linkSync(target: string, link: string): void {
		try {
			this.nodeFS.linkSync(this.path(target), this.path(link));
		} catch (err) {
			this.error(err, target);
		}
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		try {
			await using handle = await this.nodeFS.promises.open(this.path(path), 'r');
			await handle.read({ buffer, offset, length: end - offset });
		} catch (err) {
			this.error(err, path);
		}
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		let fd;
		try {
			fd = this.nodeFS.openSync(this.path(path), 'r');
			this.nodeFS.readSync(fd, buffer, { offset, length: end - offset });
		} catch (err) {
			this.error(err, path);
		} finally {
			if (fd) this.nodeFS.closeSync(fd);
		}
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		try {
			await using handle = await this.nodeFS.promises.open(this.path(path), 'w');
			await handle.write(buffer, offset);
		} catch (err) {
			this.error(err, path);
		}
	}

	public writeSync(path: string, buffer: Uint8Array, offset: number): void {
		let fd;
		try {
			fd = this.nodeFS.openSync(this.path(path), 'w');
			this.nodeFS.writeSync(fd, buffer, offset);
		} catch (err) {
			this.error(err, path);
		} finally {
			if (fd) this.nodeFS.closeSync(fd);
		}
	}
}

const _Passthrough = {
	name: 'Passthrough',
	options: {
		fs: { type: 'object', required: true },
		prefix: { type: 'string', required: true },
	},
	create({ fs, prefix }: PassthroughOptions) {
		return new PassthroughFS(fs, resolve(prefix));
	},
} as const satisfies Backend<PassthroughFS, PassthroughOptions>;

type _Passthrough = typeof _Passthrough;

/**
 * A file system that passes through to another FS
 * @category Backends and Configuration
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Passthrough extends _Passthrough {}

/**
 * A file system that passes through to another FS
 */
export const Passthrough: Passthrough = _Passthrough;
