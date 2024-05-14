import { ErrnoError } from '../error.js';
import type { Cred } from '../cred.js';
import type { File } from '../file.js';
import type { FileSystem, FileSystemMetadata } from '../filesystem.js';
import { Mutex } from '../mutex.js';
import type { Stats } from '../stats.js';

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
	private _mu: Mutex = new Mutex();

	constructor(public readonly fs: FS) {}

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
		await this._mu.lock(oldPath);
		await this.fs.rename(oldPath, newPath, cred);
		this._mu.unlock(oldPath);
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		if (this._mu.isLocked(oldPath)) {
			throw ErrnoError.With('EBUSY', oldPath, 'rename');
		}
		return this.fs.renameSync(oldPath, newPath, cred);
	}

	public async stat(path: string, cred: Cred): Promise<Stats> {
		await this._mu.lock(path);
		const stats = await this.fs.stat(path, cred);
		this._mu.unlock(path);
		return stats;
	}

	public statSync(path: string, cred: Cred): Stats {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'stat');
		}
		return this.fs.statSync(path, cred);
	}

	public async openFile(path: string, flag: string, cred: Cred): Promise<File> {
		await this._mu.lock(path);
		const fd = await this.fs.openFile(path, flag, cred);
		this._mu.unlock(path);
		return fd;
	}

	public openFileSync(path: string, flag: string, cred: Cred): File {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'openFile');
		}
		return this.fs.openFileSync(path, flag, cred);
	}

	public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
		await this._mu.lock(path);
		const fd = await this.fs.createFile(path, flag, mode, cred);
		this._mu.unlock(path);
		return fd;
	}

	public createFileSync(path: string, flag: string, mode: number, cred: Cred): File {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'createFile');
		}
		return this.fs.createFileSync(path, flag, mode, cred);
	}

	public async unlink(p: string, cred: Cred): Promise<void> {
		await this._mu.lock(p);
		await this.fs.unlink(p, cred);
		this._mu.unlock(p);
	}

	public unlinkSync(path: string, cred: Cred): void {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'unlink');
		}
		return this.fs.unlinkSync(path, cred);
	}

	public async rmdir(path: string, cred: Cred): Promise<void> {
		await this._mu.lock(path);
		await this.fs.rmdir(path, cred);
		this._mu.unlock(path);
	}

	public rmdirSync(path: string, cred: Cred): void {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'rmdir');
		}
		return this.fs.rmdirSync(path, cred);
	}

	public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
		await this._mu.lock(path);
		await this.fs.mkdir(path, mode, cred);
		this._mu.unlock(path);
	}

	public mkdirSync(path: string, mode: number, cred: Cred): void {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'mkdir');
		}
		return this.fs.mkdirSync(path, mode, cred);
	}

	public async readdir(path: string, cred: Cred): Promise<string[]> {
		await this._mu.lock(path);
		const files = await this.fs.readdir(path, cred);
		this._mu.unlock(path);
		return files;
	}

	public readdirSync(path: string, cred: Cred): string[] {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'readdir');
		}
		return this.fs.readdirSync(path, cred);
	}

	public async exists(path: string, cred: Cred): Promise<boolean> {
		await this._mu.lock(path);
		const exists = await this.fs.exists(path, cred);
		this._mu.unlock(path);
		return exists;
	}

	public existsSync(path: string, cred: Cred): boolean {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'exists');
		}
		return this.fs.existsSync(path, cred);
	}

	public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		await this._mu.lock(srcpath);
		await this.fs.link(srcpath, dstpath, cred);
		this._mu.unlock(srcpath);
	}

	public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
		if (this._mu.isLocked(srcpath)) {
			throw ErrnoError.With('EBUSY', srcpath, 'link');
		}
		return this.fs.linkSync(srcpath, dstpath, cred);
	}

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		await this._mu.lock(path);
		await this.fs.sync(path, data, stats);
		this._mu.unlock(path);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		if (this._mu.isLocked(path)) {
			throw ErrnoError.With('EBUSY', path, 'sync');
		}
		return this.fs.syncSync(path, data, stats);
	}
}
