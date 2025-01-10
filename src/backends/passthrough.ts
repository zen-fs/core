import type * as fs from 'node:fs';
import type { Backend } from './backend.js';
import { FileSystem } from '../filesystem.js';
import type { Errno } from '../error.js';
import { ErrnoError } from '../error.js';
import { Stats } from '../stats.js';
import { File } from '../file.js';
import { join, resolve } from '../vfs/path.js';

// Type for Node.js fs module
export type NodeFS = typeof fs;

// Interface for Passthrough backend options
export interface PassthroughOptions {
	fs: NodeFS;
	prefix?: string;
}

class PassthroughFile extends File<PassthroughFS> {
	protected node: NodeFS;
	protected nodePath: string;

	public constructor(
		fs: PassthroughFS,
		path: string,
		public readonly fd: number
	) {
		super(fs, path);
		this.node = fs.nodeFS;
		this.nodePath = fs.path(path);
	}

	protected error(err: unknown): ErrnoError {
		const error = err as NodeJS.ErrnoException;
		return ErrnoError.With(error.code as keyof typeof Errno, this.path, error.syscall);
	}

	public get position(): number {
		// Placeholder: Implement proper position tracking if needed.
		return 0;
	}

	public async stat(): Promise<Stats> {
		const { resolve, reject, promise } = Promise.withResolvers<Stats>();

		this.node.fstat(this.fd, (err, stats) => (err ? reject(this.error(err)) : resolve(new Stats(stats))));

		return promise;
	}

	public statSync(): Stats {
		return new Stats(this.node.fstatSync(this.fd));
	}

	public close(): Promise<void> {
		const { resolve, reject, promise } = Promise.withResolvers<void>();
		this.node.close(this.fd, err => (err ? reject(this.error(err)) : resolve()));
		return promise;
	}

	public closeSync(): void {
		this.node.closeSync(this.fd);
	}

	public async truncate(len: number): Promise<void> {
		await this.node.promises.truncate(this.nodePath, len);
	}

	public truncateSync(len: number): void {
		this.node.ftruncateSync(this.fd, len);
	}

	public async sync(): Promise<void> {
		const { resolve, reject, promise } = Promise.withResolvers<void>();
		this.node.fsync(this.fd, err => (err ? reject(this.error(err)) : resolve()));
		return promise;
	}

	public syncSync(): void {
		this.node.fsyncSync(this.fd);
	}

	public async write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number> {
		const { resolve, reject, promise } = Promise.withResolvers<number>();
		this.node.write(this.fd, buffer, offset, length, position, (err, written) => (err ? reject(this.error(err)) : resolve(written)));
		return promise;
	}

	public writeSync(buffer: Uint8Array, offset?: number, length?: number, position?: number): number {
		return this.node.writeSync(this.fd, buffer, offset, length, position);
	}

	public async read<TBuffer extends NodeJS.ArrayBufferView>(
		buffer: TBuffer,
		offset: number = 0,
		length?: number,
		position: number | null = null
	): Promise<{ bytesRead: number; buffer: TBuffer }> {
		const { resolve, reject, promise } = Promise.withResolvers<{ bytesRead: number; buffer: TBuffer }>();
		this.node.read(this.fd, buffer, offset, length || (await this.stat()).size, position, (err, bytesRead, buffer) =>
			err ? reject(this.error(err)) : resolve({ bytesRead, buffer })
		);
		return promise;
	}

	public readSync(buffer: NodeJS.ArrayBufferView, offset: number = 0, length: number = this.statSync().size, position: number | null = null): number {
		return this.node.readSync(this.fd, buffer, offset, length, position);
	}

	public async chmod(mode: number): Promise<void> {
		await this.node.promises.chmod(this.nodePath, mode);
	}

	public chmodSync(mode: number): void {
		this.node.fchmodSync(this.fd, mode);
	}

	public async chown(uid: number, gid: number): Promise<void> {
		await this.node.promises.chown(this.nodePath, uid, gid);
	}

	public chownSync(uid: number, gid: number): void {
		this.node.fchownSync(this.fd, uid, gid);
	}

	public async utimes(atime: number, mtime: number): Promise<void> {
		await this.node.promises.utimes(this.nodePath, atime, mtime);
	}

	public utimesSync(atime: number, mtime: number): void {
		this.node.futimesSync(this.fd, atime, mtime);
	}
}

export class PassthroughFS extends FileSystem {
	public constructor(
		public readonly nodeFS: NodeFS,
		public readonly prefix: string
	) {
		super();
	}

	public path(path: string): string {
		return join(this.prefix, path.slice(1));
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
	public async stat(path: string): Promise<Stats> {
		try {
			return new Stats(await this.nodeFS.promises.stat(this.path(path)));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Get file statistics synchronously.
	 */
	public statSync(path: string): Stats {
		try {
			return new Stats(this.nodeFS.statSync(this.path(path)));
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Open a file.
	 */
	public async openFile(path: string, flag: string): Promise<File> {
		try {
			const { fd } = await this.nodeFS.promises.open(this.path(path), flag);
			return new PassthroughFile(this, path, fd);
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Open a file synchronously.
	 */
	public openFileSync(path: string, flag: string): File {
		try {
			const fd = this.nodeFS.openSync(this.path(path), flag);
			return new PassthroughFile(this, path, fd);
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
	public async mkdir(path: string, mode: number): Promise<void> {
		try {
			await this.nodeFS.promises.mkdir(this.path(path), { mode });
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Create a directory synchronously.
	 */
	public mkdirSync(path: string, mode: number): void {
		try {
			this.nodeFS.mkdirSync(this.path(path), { mode });
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
	public async createFile(path: string, flag: string, mode: number): Promise<File> {
		try {
			const { fd } = await this.nodeFS.promises.open(this.path(path), flag, mode);
			return new PassthroughFile(this, path, fd);
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Create a file synchronously.
	 */
	public createFileSync(path: string, flag: string, mode: number): File {
		try {
			const fd = this.nodeFS.openSync(this.path(path), flag, mode);
			return new PassthroughFile(this, path, fd);
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
	public async sync(path: string, data: Uint8Array, stats: Stats): Promise<void> {
		try {
			await this.nodeFS.promises.writeFile(this.path(path), data);
		} catch (err) {
			this.error(err, path);
		}
	}

	/**
	 * Synchronize data to the file system synchronously.
	 */
	public syncSync(path: string, data: Uint8Array, stats: Stats): void {
		try {
			this.nodeFS.writeFileSync(this.path(path), data);
		} catch (err) {
			this.error(err, path);
		}
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

	public async read(path: string, offset: number, length: number): Promise<Uint8Array> {
		try {
			await using handle = await this.nodeFS.promises.open(this.path(path), 'r');
			const buffer = new Uint8Array(length);
			await handle.read({ buffer, offset, length });
			return buffer;
		} catch (err) {
			this.error(err, path);
		}
	}
	public readSync(path: string, offset: number, length: number): Uint8Array {
		let fd;
		try {
			fd = this.nodeFS.openSync(this.path(path), 'r');
			const buffer = new Uint8Array(length);
			this.nodeFS.readSync(fd, buffer, { offset, length });
			return buffer;
		} catch (err) {
			this.error(err, path);
		} finally {
			if (fd) this.nodeFS.closeSync(fd);
		}

		// unreachable
		throw ErrnoError.With('EIO', path, 'read');
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
		prefix: { type: 'string', required: false },
	},
	create({ fs, prefix = '/' }: PassthroughOptions) {
		return new PassthroughFS(fs, resolve(prefix));
	},
} as const satisfies Backend<PassthroughFS, PassthroughOptions>;

type _Passthrough = typeof _Passthrough;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Passthrough extends _Passthrough {}

/**
 * A file system that passes through to another FS
 */
export const Passthrough: Passthrough = _Passthrough;
