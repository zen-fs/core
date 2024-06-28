import { Errno, ErrnoError } from '../error.js';
import type { Cred } from '../cred.js';
import type { File } from '../file.js';
import type { FileSystem, FileSystemMetadata } from '../filesystem.js';
import type { Stats } from '../stats.js';

export interface MutexLock extends PromiseWithResolvers<void> {
	[Symbol.dispose](): void;
}

/**
 * This class serializes access to an underlying async filesystem.
 * For example, on an OverlayFS instance with an async lower
 * directory operations like rename and rmdir may involve multiple
 * requests involving both the upper and lower filesystems -- they
 * are not executed in a single atomic step.  OverlayFS uses this
 * LockedFS to avoid having to reason about the correctness of
 * multiple requests interleaving.
 * @internal
 */
export class LockedFS<FS extends FileSystem> implements FileSystem {
	constructor(public readonly fs: FS) {}

	/**
	 * The current locks
	 */
	private locks: Map<string, MutexLock> = new Map();

	private addLock(path: string): MutexLock {
		const lock: MutexLock = {
			...Promise.withResolvers(),
			[Symbol.dispose]: () => {
				this.unlock(path);
			},
		};
		this.locks.set(path, lock);
		return lock;
	}

	/**
	 * Locks `path` asynchronously.
	 * If the path is currently locked, waits for it to be unlocked.
	 */
	protected async lock(path: string): Promise<MutexLock> {
		if (this.locks.has(path)) {
			// Non-null assertion: we already checked locks has path
			await this.locks.get(path)!.promise;
		}

		return this.addLock(path);
	}

	/**
	 * Unlocks a path
	 * @param path The path to lock
	 * @param noThrow If true, an error will not be thrown if the path is already unlocked
	 * @returns Whether the path was unlocked
	 */
	protected unlock(path: string, noThrow: boolean = false): boolean {
		if (!this.locks.has(path)) {
			if (noThrow) {
				return false;
			}
			throw new ErrnoError(Errno.EPERM, 'Can not unlock an already unlocked path', path);
		}

		// Non-null assertion: we already checked locks has path
		this.locks.get(path)!.resolve();
		this.locks.delete(path);
		return true;
	}

	/**
	 * Attempt to lock `path` synchronously
	 */
	protected tryLock(path: string): boolean {
		if (this.locks.has(path)) {
			return false;
		}

		this.addLock(path);
		return true;
	}

	protected isLocked(path: string): boolean {
		return this.locks.has(path);
	}

	public async ready(): Promise<void> {
		await this.fs.ready();
	}

	public metadata(): FileSystemMetadata {
		return {
			...this.fs.metadata(),
			name: 'Locked<' + this.fs.metadata().name + '>',
		};
	}

	public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(oldPath);
		await this.fs.rename(oldPath, newPath, cred);
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		if (this.isLocked(oldPath)) {
			throw ErrnoError.With('EBUSY', oldPath, 'rename');
		}
		return this.fs.renameSync(oldPath, newPath, cred);
	}

	public async stat(path: string, cred: Cred): Promise<Stats> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		const stats = await this.fs.stat(path, cred);
		return stats;
	}

	public statSync(path: string, cred: Cred): Stats {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'stat');
		}
		return this.fs.statSync(path, cred);
	}

	public async openFile(path: string, flag: string, cred: Cred): Promise<File> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		const fd = await this.fs.openFile(path, flag, cred);
		return fd;
	}

	public openFileSync(path: string, flag: string, cred: Cred): File {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'openFile');
		}
		return this.fs.openFileSync(path, flag, cred);
	}

	public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		const fd = await this.fs.createFile(path, flag, mode, cred);
		return fd;
	}

	public createFileSync(path: string, flag: string, mode: number, cred: Cred): File {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'createFile');
		}
		return this.fs.createFileSync(path, flag, mode, cred);
	}

	public async unlink(path: string, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		await this.fs.unlink(path, cred);
	}

	public unlinkSync(path: string, cred: Cred): void {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'unlink');
		}
		return this.fs.unlinkSync(path, cred);
	}

	public async rmdir(path: string, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		await this.fs.rmdir(path, cred);
	}

	public rmdirSync(path: string, cred: Cred): void {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'rmdir');
		}
		return this.fs.rmdirSync(path, cred);
	}

	public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		await this.fs.mkdir(path, mode, cred);
	}

	public mkdirSync(path: string, mode: number, cred: Cred): void {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'mkdir');
		}
		return this.fs.mkdirSync(path, mode, cred);
	}

	public async readdir(path: string, cred: Cred): Promise<string[]> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		const files = await this.fs.readdir(path, cred);
		return files;
	}

	public readdirSync(path: string, cred: Cred): string[] {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'readdir');
		}
		return this.fs.readdirSync(path, cred);
	}

	public async exists(path: string, cred: Cred): Promise<boolean> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		const exists = await this.fs.exists(path, cred);
		return exists;
	}

	public existsSync(path: string, cred: Cred): boolean {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'exists');
		}
		return this.fs.existsSync(path, cred);
	}

	public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(srcpath);
		await this.fs.link(srcpath, dstpath, cred);
	}

	public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
		if (this.isLocked(srcpath)) {
			throw ErrnoError.With('EBUSY', srcpath, 'link');
		}
		return this.fs.linkSync(srcpath, dstpath, cred);
	}

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		await this.fs.sync(path, data, stats);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		if (this.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'sync');
		}
		return this.fs.syncSync(path, data, stats);
	}
}
