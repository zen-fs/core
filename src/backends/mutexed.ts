import type { Cred } from '../cred.js';
import { Errno, ErrnoError } from '../error.js';
import type { File } from '../file.js';
import type { FileSystemMetadata } from '../filesystem.js';
import { FileSystem } from '../filesystem.js';
import type { Stats } from '../stats.js';
import type { Backend } from './backend.js';
import '../polyfills.js';

export class MutexLock {
	protected current = Promise.withResolvers<void>();

	protected _isLocked: boolean = true;
	public get isLocked(): boolean {
		return this._isLocked;
	}

	public constructor(
		public readonly path: string,
		protected readonly previous?: MutexLock
	) {}

	public async done(): Promise<void> {
		await this.previous?.done();
		await this.current.promise;
	}

	public unlock(): void {
		this.current.resolve();
		this._isLocked = false;
	}

	public [Symbol.dispose](): void {
		this.unlock();
	}
}

/**
 * This class serializes access to an underlying async filesystem.
 * For example, on an OverlayFS instance with an async lower
 * directory operations like rename and rmdir may involve multiple
 * requests involving both the upper and lower filesystems -- they
 * are not executed in a single atomic step. OverlayFS uses this
 * to avoid having to reason about the correctness of
 * multiple requests interleaving.
 * @internal
 */
export class MutexedFS<FS extends FileSystem> implements FileSystem {
	public constructor(public readonly fs: FS) {}

	/**
	 * The current locks
	 */
	private locks: Map<string, MutexLock> = new Map();

	/**
	 * Adds a lock for a path
	 */
	protected addLock(path: string): MutexLock {
		const previous = this.locks.get(path);
		const lock = new MutexLock(path, previous?.isLocked ? previous : undefined);
		this.locks.set(path, lock);
		return lock;
	}

	/**
	 * Locks `path` asynchronously.
	 * If the path is currently locked, waits for it to be unlocked.
	 * @internal
	 */
	public async lock(path: string): Promise<MutexLock> {
		const previous = this.locks.get(path);
		const lock = this.addLock(path);
		await previous?.done();
		return lock;
	}

	/**
	 * Locks `path` asynchronously.
	 * If the path is currently locked, an error will be thrown
	 * @internal
	 */
	public lockSync(path: string): MutexLock {
		if (this.locks.has(path)) {
			// Non-null assertion: we already checked locks has path
			throw ErrnoError.With('EBUSY', path, 'lockSync');
		}

		return this.addLock(path);
	}

	/**
	 * Whether `path` is locked
	 * @internal
	 */
	public isLocked(path: string): boolean {
		return !!this.locks.get(path)?.isLocked;
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
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(oldPath);
		return this.fs.renameSync(oldPath, newPath, cred);
	}

	public async stat(path: string, cred: Cred): Promise<Stats> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		return await this.fs.stat(path, cred);
	}

	public statSync(path: string, cred: Cred): Stats {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.statSync(path, cred);
	}

	public async openFile(path: string, flag: string, cred: Cred): Promise<File> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		return await this.fs.openFile(path, flag, cred);
	}

	public openFileSync(path: string, flag: string, cred: Cred): File {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.openFileSync(path, flag, cred);
	}

	public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		return await this.fs.createFile(path, flag, mode, cred);
	}

	public createFileSync(path: string, flag: string, mode: number, cred: Cred): File {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.createFileSync(path, flag, mode, cred);
	}

	public async unlink(path: string, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		await this.fs.unlink(path, cred);
	}

	public unlinkSync(path: string, cred: Cred): void {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.unlinkSync(path, cred);
	}

	public async rmdir(path: string, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		await this.fs.rmdir(path, cred);
	}

	public rmdirSync(path: string, cred: Cred): void {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.rmdirSync(path, cred);
	}

	public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		await this.fs.mkdir(path, mode, cred);
	}

	public mkdirSync(path: string, mode: number, cred: Cred): void {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.mkdirSync(path, mode, cred);
	}

	public async readdir(path: string, cred: Cred): Promise<string[]> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		return await this.fs.readdir(path, cred);
	}

	public readdirSync(path: string, cred: Cred): string[] {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.readdirSync(path, cred);
	}

	public async exists(path: string, cred: Cred): Promise<boolean> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		return await this.fs.exists(path, cred);
	}

	public existsSync(path: string, cred: Cred): boolean {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.existsSync(path, cred);
	}

	public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(srcpath);
		await this.fs.link(srcpath, dstpath, cred);
	}

	public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(srcpath);
		return this.fs.linkSync(srcpath, dstpath, cred);
	}

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = await this.lock(path);
		await this.fs.sync(path, data, stats);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		using _ = this.lockSync(path);
		return this.fs.syncSync(path, data, stats);
	}
}

export const _Mutexed = {
	name: 'Mutexed',
	options: {
		fs: {
			type: 'object',
			required: true,
			description: '',
			validator(fs) {
				if (!(fs instanceof FileSystem)) {
					throw new ErrnoError(Errno.EINVAL, 'Not a valid FileSystem');
				}
			},
		},
	},
	isAvailable() {
		return true;
	},
	create({ fs }) {
		return new MutexedFS(fs);
	},
} satisfies Backend<MutexedFS<FileSystem>, { fs: FileSystem }>;
type _mutexed = typeof _Mutexed;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Mutexed extends _mutexed {}
export const Mutexed: Mutexed = _Mutexed;
