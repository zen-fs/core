import Mutex from '../mutex.js';
import { FileSystem, FileSystemMetadata } from '../filesystem.js';
import { FileFlag } from '../file.js';
import { Stats } from '../stats.js';
import { File } from '../file.js';
import { Cred } from '../cred.js';

/**
 * This class serializes access to an underlying async filesystem.
 * For example, on an OverlayFS instance with an async lower
 * directory operations like rename and rmdir may involve multiple
 * requests involving both the upper and lower filesystems -- they
 * are not executed in a single atomic step.  OverlayFS uses this
 * LockedFS to avoid having to reason about the correctness of
 * multiple requests interleaving.
 */
export default class LockedFS<T extends FileSystem> implements FileSystem {
	private _mu: Mutex = new Mutex();

	constructor(public readonly fs: T) {
		this.fs = fs;
	}

	public async ready(): Promise<this> {
		await this.fs.ready();
		return this;
	}

	public get metadata(): FileSystemMetadata {
		return {
			...this.fs.metadata,
			name: 'Locked<' + this.fs.metadata.name + '>',
		};
	}

	public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		await this._mu.lock(oldPath);
		await this.fs.rename(oldPath, newPath, cred);
		this._mu.unlock(oldPath);
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		if (this._mu.isLocked(oldPath)) {
			throw new Error('invalid sync call');
		}
		return this.fs.renameSync(oldPath, newPath, cred);
	}

	public async stat(p: string, cred: Cred): Promise<Stats> {
		await this._mu.lock(p);
		const stats = await this.fs.stat(p, cred);
		this._mu.unlock(p);
		return stats;
	}

	public statSync(p: string, cred: Cred): Stats {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.statSync(p, cred);
	}

	public async open(p: string, flag: FileFlag, mode: number, cred: Cred): Promise<File> {
		await this._mu.lock(p);
		const fd = await this.fs.open(p, flag, mode, cred);
		this._mu.unlock(p);
		return fd;
	}

	public openSync(p: string, flag: FileFlag, mode: number, cred: Cred): File {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.openSync(p, flag, mode, cred);
	}

	public async openFile(path: string, flag: FileFlag, cred: Cred): Promise<File> {
		await this._mu.lock(path);
		const fd = await this.fs.openFile(path, flag, cred);
		this._mu.unlock(path);
		return fd;
	}

	public openFileSync(path: string, flag: FileFlag, cred: Cred): File {
		if (this._mu.isLocked(path)) {
			throw new Error('invalid sync call');
		}
		return this.fs.openFileSync(path, flag, cred);
	}

	public async createFile(path: string, flag: FileFlag, mode: number, cred: Cred): Promise<File> {
		await this._mu.lock(path);
		const fd = await this.fs.createFile(path, flag, mode, cred);
		this._mu.unlock(path);
		return fd;
	}

	public createFileSync(path: string, flag: FileFlag, mode: number, cred: Cred): File {
		if (this._mu.isLocked(path)) {
			throw new Error('invalid sync call');
		}
		return this.fs.createFileSync(path, flag, mode, cred);
	}

	public async unlink(p: string, cred: Cred): Promise<void> {
		await this._mu.lock(p);
		await this.fs.unlink(p, cred);
		this._mu.unlock(p);
	}

	public unlinkSync(p: string, cred: Cred): void {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.unlinkSync(p, cred);
	}

	public async rmdir(p: string, cred: Cred): Promise<void> {
		await this._mu.lock(p);
		await this.fs.rmdir(p, cred);
		this._mu.unlock(p);
	}

	public rmdirSync(p: string, cred: Cred): void {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.rmdirSync(p, cred);
	}

	public async mkdir(p: string, mode: number, cred: Cred): Promise<void> {
		await this._mu.lock(p);
		await this.fs.mkdir(p, mode, cred);
		this._mu.unlock(p);
	}

	public mkdirSync(p: string, mode: number, cred: Cred): void {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.mkdirSync(p, mode, cred);
	}

	public async readdir(p: string, cred: Cred): Promise<string[]> {
		await this._mu.lock(p);
		const files = await this.fs.readdir(p, cred);
		this._mu.unlock(p);
		return files;
	}

	public readdirSync(p: string, cred: Cred): string[] {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.readdirSync(p, cred);
	}

	public async exists(p: string, cred: Cred): Promise<boolean> {
		await this._mu.lock(p);
		const exists = await this.fs.exists(p, cred);
		this._mu.unlock(p);
		return exists;
	}

	public existsSync(p: string, cred: Cred): boolean {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.existsSync(p, cred);
	}

	public async realpath(p: string, cred: Cred): Promise<string> {
		await this._mu.lock(p);
		const resolvedPath = await this.fs.realpath(p, cred);
		this._mu.unlock(p);
		return resolvedPath;
	}

	public realpathSync(p: string, cred: Cred): string {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.realpathSync(p, cred);
	}

	public async truncate(p: string, len: number, cred: Cred): Promise<void> {
		await this._mu.lock(p);
		await this.fs.truncate(p, len, cred);
		this._mu.unlock(p);
	}

	public truncateSync(p: string, len: number, cred: Cred): void {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.truncateSync(p, len, cred);
	}

	public async readFile(fname: string, flag: FileFlag, cred: Cred): Promise<Uint8Array> {
		await this._mu.lock(fname);
		const data = await this.fs.readFile(fname, flag, cred);
		this._mu.unlock(fname);
		return data;
	}

	public readFileSync(fname: string, flag: FileFlag, cred: Cred): Uint8Array {
		if (this._mu.isLocked(fname)) {
			throw new Error('invalid sync call');
		}
		return this.fs.readFileSync(fname, flag, cred);
	}

	public async writeFile(fname: string, data: Uint8Array, flag: FileFlag, mode: number, cred: Cred): Promise<void> {
		await this._mu.lock(fname);
		await this.fs.writeFile(fname, data, flag, mode, cred);
		this._mu.unlock(fname);
	}

	public writeFileSync(fname: string, data: Uint8Array, flag: FileFlag, mode: number, cred: Cred): void {
		if (this._mu.isLocked(fname)) {
			throw new Error('invalid sync call');
		}
		return this.fs.writeFileSync(fname, data, flag, mode, cred);
	}

	public async appendFile(fname: string, data: Uint8Array, flag: FileFlag, mode: number, cred: Cred): Promise<void> {
		await this._mu.lock(fname);
		await this.fs.appendFile(fname, data, flag, mode, cred);
		this._mu.unlock(fname);
	}

	public appendFileSync(fname: string, data: Uint8Array, flag: FileFlag, mode: number, cred: Cred): void {
		if (this._mu.isLocked(fname)) {
			throw new Error('invalid sync call');
		}
		return this.fs.appendFileSync(fname, data, flag, mode, cred);
	}

	public async chmod(p: string, mode: number, cred: Cred): Promise<void> {
		await this._mu.lock(p);
		await this.fs.chmod(p, mode, cred);
		this._mu.unlock(p);
	}

	public chmodSync(p: string, mode: number, cred: Cred): void {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.chmodSync(p, mode, cred);
	}

	public async chown(p: string, new_uid: number, new_gid: number, cred: Cred): Promise<void> {
		await this._mu.lock(p);
		await this.fs.chown(p, new_uid, new_gid, cred);
		this._mu.unlock(p);
	}

	public chownSync(p: string, new_uid: number, new_gid: number, cred: Cred): void {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.chownSync(p, new_uid, new_gid, cred);
	}

	public async utimes(p: string, atime: Date, mtime: Date, cred: Cred): Promise<void> {
		await this._mu.lock(p);
		await this.fs.utimes(p, atime, mtime, cred);
		this._mu.unlock(p);
	}

	public utimesSync(p: string, atime: Date, mtime: Date, cred: Cred): void {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.utimesSync(p, atime, mtime, cred);
	}

	public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		await this._mu.lock(srcpath);
		await this.fs.link(srcpath, dstpath, cred);
		this._mu.unlock(srcpath);
	}

	public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
		if (this._mu.isLocked(srcpath)) {
			throw new Error('invalid sync call');
		}
		return this.fs.linkSync(srcpath, dstpath, cred);
	}

	public async symlink(srcpath: string, dstpath: string, type: string, cred: Cred): Promise<void> {
		await this._mu.lock(srcpath);
		await this.fs.symlink(srcpath, dstpath, type, cred);
		this._mu.unlock(srcpath);
	}

	public symlinkSync(srcpath: string, dstpath: string, type: string, cred: Cred): void {
		if (this._mu.isLocked(srcpath)) {
			throw new Error('invalid sync call');
		}
		return this.fs.symlinkSync(srcpath, dstpath, type, cred);
	}

	public async readlink(p: string, cred: Cred): Promise<string> {
		await this._mu.lock(p);
		const linkString = await this.fs.readlink(p, cred);
		this._mu.unlock(p);
		return linkString;
	}

	public readlinkSync(p: string, cred: Cred): string {
		if (this._mu.isLocked(p)) {
			throw new Error('invalid sync call');
		}
		return this.fs.readlinkSync(p, cred);
	}

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		await this._mu.lock(path);
		await this.fs.sync(path, data, stats);
		this._mu.unlock(path);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		if (this._mu.isLocked(path)) {
			throw new Error('invalid sync call');
		}
		return this.fs.syncSync(path, data, stats);
	}
}
