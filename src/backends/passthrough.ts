// SPDX-License-Identifier: LGPL-3.0-or-later
import { err, warn } from 'kerium/log';
import type { CreationOptions, UsageInfo } from '../internal/filesystem.js';
import { FileSystem } from '../internal/filesystem.js';
import { isDirectory, type InodeLike } from '../internal/inode.js';
import type { NodeFS } from '../node/types.js';
import type { Backend } from './backend.js';

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

	/**
	 * Rename a file or directory.
	 */
	public async rename(oldPath: string, newPath: string): Promise<void> {
		await this.nodeFS.promises.rename(this.path(oldPath), this.path(newPath));
	}

	/**
	 * Rename a file or directory synchronously.
	 */
	public renameSync(oldPath: string, newPath: string): void {
		this.nodeFS.renameSync(this.path(oldPath), this.path(newPath));
	}

	/**
	 * Get file statistics.
	 */
	public async stat(path: string): Promise<InodeLike> {
		return await this.nodeFS.promises.stat(this.path(path));
	}

	/**
	 * Get file statistics synchronously.
	 */
	public statSync(path: string): InodeLike {
		return this.nodeFS.statSync(this.path(path));
	}

	/**
	 * @privateRemarks
	 * Timestamps should be updated by the underlying file system.
	 */
	public async touch(path: string, metadata: InodeLike): Promise<void> {
		await using handle = await this.nodeFS.promises.open(this.path(path), 'r');
		await handle.chmod(metadata.mode);
		try {
			await handle.chown(metadata.uid, metadata.gid);
		} catch (error: any) {
			err('Failed to chown passthrough file: ' + error.message);
		}
	}

	/**
	 * @privateRemarks
	 * Timestamps should be updated by the underlying file system.
	 */
	public touchSync(path: string, metadata: InodeLike): void {
		this.nodeFS.chmodSync(this.path(path), metadata.mode);
		try {
			this.nodeFS.chownSync(this.path(path), metadata.uid, metadata.gid);
		} catch (error: any) {
			err('Failed to chown passthrough file: ' + error.message);
		}
	}

	/**
	 * Unlink (delete) a file.
	 */
	public async unlink(path: string): Promise<void> {
		await this.nodeFS.promises.unlink(this.path(path));
	}

	/**
	 * Unlink (delete) a file synchronously.
	 */
	public unlinkSync(path: string): void {
		this.nodeFS.unlinkSync(this.path(path));
	}

	/**
	 * Create a directory.
	 */
	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		await this.nodeFS.promises.mkdir(this.path(path), options);
		return await this.nodeFS.promises.stat(this.path(path));
	}

	/**
	 * Create a directory synchronously.
	 */
	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		this.nodeFS.mkdirSync(this.path(path), options);
		return this.nodeFS.statSync(this.path(path));
	}

	/**
	 * Read the contents of a directory.
	 */
	public async readdir(path: string): Promise<string[]> {
		return await this.nodeFS.promises.readdir(this.path(path));
	}

	/**
	 * Read the contents of a directory synchronously.
	 */
	public readdirSync(path: string): string[] {
		return this.nodeFS.readdirSync(this.path(path));
	}

	/**
	 * Create a file.
	 */
	public async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		if (isDirectory(options)) {
			await this.nodeFS.promises.mkdir(this.path(path), { mode: options.mode });
		} else {
			await using handle = await this.nodeFS.promises.open(this.path(path), 'wx');
			await handle.close();
		}

		return await this.nodeFS.promises.stat(this.path(path));
	}

	/**
	 * Create a file synchronously.
	 */
	public createFileSync(path: string, options: CreationOptions): InodeLike {
		if (isDirectory(options)) {
			this.nodeFS.mkdirSync(this.path(path), { mode: options.mode });
		} else {
			const fd = this.nodeFS.openSync(this.path(path), 'wx');
			this.nodeFS.closeSync(fd);
		}
		return this.nodeFS.statSync(this.path(path));
	}

	/**
	 * Remove a directory.
	 */
	public async rmdir(path: string): Promise<void> {
		await this.nodeFS.promises.rmdir(this.path(path));
	}

	/**
	 * Remove a directory synchronously.
	 */
	public rmdirSync(path: string): void {
		this.nodeFS.rmdirSync(this.path(path));
	}

	/**
	 * Synchronize data to the file system.
	 */
	public async sync(): Promise<void> {
		warn('Sync on passthrough is unnecessary');
	}

	/**
	 * Synchronize data to the file system synchronously.
	 */
	public syncSync(): void {
		warn('Sync on passthrough is unnecessary');
	}

	/**
	 * Create a hard link.
	 */
	public async link(target: string, link: string): Promise<void> {
		await this.nodeFS.promises.link(this.path(target), this.path(link));
	}

	/**
	 * Create a hard link synchronously.
	 */
	public linkSync(target: string, link: string): void {
		this.nodeFS.linkSync(this.path(target), this.path(link));
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		await using handle = await this.nodeFS.promises.open(this.path(path), 'r');
		await handle.read({ buffer, offset, length: end - offset });
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		const fd = this.nodeFS.openSync(this.path(path), 'r');
		try {
			this.nodeFS.readSync(fd, buffer, { offset, length: end - offset });
		} finally {
			this.nodeFS.closeSync(fd);
		}
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		await using handle = await this.nodeFS.promises.open(this.path(path), 'w');
		await handle.write(buffer, offset);
	}

	public writeSync(path: string, buffer: Uint8Array, offset: number): void {
		const fd = this.nodeFS.openSync(this.path(path), 'w');
		try {
			this.nodeFS.writeSync(fd, buffer, offset);
		} finally {
			this.nodeFS.closeSync(fd);
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
		return new PassthroughFS(fs, prefix);
	},
} as const satisfies Backend<PassthroughFS, PassthroughOptions>;

type _Passthrough = typeof _Passthrough;

/**
 * A file system that passes through to another FS
 * @category Backends and Configuration
 */
export interface Passthrough extends _Passthrough {}

/**
 * A file system that passes through to another FS
 */
export const Passthrough: Passthrough = _Passthrough;
