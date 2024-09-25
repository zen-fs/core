import { ErrnoError } from '../error.js';
import type { File } from '../file.js';
import type { FileSystem, FileSystemMetadata } from '../filesystem.js';
import '../polyfills.js';
import type { Stats } from '../stats.js';
import type { Concrete } from '../utils.js';
import type { ConcreteFS, Mixin } from './shared.js';

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
 * This serializes access to an underlying async filesystem.
 * For example, on an OverlayFS instance with an async lower
 * directory operations like rename and rmdir may involve multiple
 * requests involving both the upper and lower filesystems -- they
 * are not executed in a single atomic step. OverlayFS uses this
 * to avoid having to reason about the correctness of
 * multiple requests interleaving.
 *
 * Note:
 * Instead of extending the passed class, `MutexedFS` stores it internally.
 * This is to avoid a deadlock caused when a mathod calls another one
 * The problem is discussed extensivly in [#78](https://github.com/zen-fs/core/issues/78)
 * Instead of extending `FileSystem`,
 * `MutexedFS` implements it in order to make sure all of the methods are passed through
 *
 * @todo Change `using _` to `using void` pending https://github.com/tc39/proposal-discard-binding
 * @internal
 */
export function Mutexed<T extends Concrete<typeof FileSystem>>(
	FS: T
): Mixin<
	Concrete<typeof FileSystem>,
	ConcreteFS & {
		lock(path: string, syscall: string): Promise<MutexLock>;
		lockSync(path: string, syscall: string): MutexLock;
		isLocked(path: string): boolean;
	}
> {
	class MutexedFS implements FileSystem {
		/**
		 * @internal
		 */
		public readonly fs: FileSystem;

		public async ready(): Promise<void> {
			return await this.fs.ready();
		}

		public metadata(): FileSystemMetadata {
			return this.fs.metadata();
		}

		public constructor(...args: ConstructorParameters<T>) {
			this.fs = new FS(...args);
		}

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
		public async lock(path: string, syscall: string): Promise<MutexLock> {
			const previous = this.locks.get(path);
			const lock = this.addLock(path);
			const stack = new Error().stack;
			setTimeout(() => {
				if (lock.isLocked) {
					const error = ErrnoError.With('EDEADLK', path, syscall);
					error.stack += stack?.slice('Error'.length);
					throw error;
				}
			}, 5000);
			await previous?.done();
			return lock;
		}

		/**
		 * Locks `path` asynchronously.
		 * If the path is currently locked, an error will be thrown
		 * @internal
		 */
		public lockSync(path: string, syscall: string): MutexLock {
			if (this.locks.has(path)) {
				throw ErrnoError.With('EBUSY', path, syscall);
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

		/* eslint-disable @typescript-eslint/no-unused-vars */
		public async rename(oldPath: string, newPath: string): Promise<void> {
			using _ = await this.lock(oldPath, 'rename');
			await this.fs.rename(oldPath, newPath);
		}

		public renameSync(oldPath: string, newPath: string): void {
			using _ = this.lockSync(oldPath, 'rename');
			return this.fs.renameSync(oldPath, newPath);
		}

		public async stat(path: string): Promise<Stats> {
			using _ = await this.lock(path, 'stat');
			return await this.fs.stat(path);
		}

		public statSync(path: string): Stats {
			using _ = this.lockSync(path, 'stat');
			return this.fs.statSync(path);
		}

		public async openFile(path: string, flag: string): Promise<File> {
			using _ = await this.lock(path, 'openFile');
			return await this.fs.openFile(path, flag);
		}

		public openFileSync(path: string, flag: string): File {
			using _ = this.lockSync(path, 'openFile');
			return this.fs.openFileSync(path, flag);
		}

		public async createFile(path: string, flag: string, mode: number): Promise<File> {
			using _ = await this.lock(path, 'createFile');
			return await this.fs.createFile(path, flag, mode);
		}

		public createFileSync(path: string, flag: string, mode: number): File {
			using _ = this.lockSync(path, 'createFile');
			return this.fs.createFileSync(path, flag, mode);
		}

		public async unlink(path: string): Promise<void> {
			using _ = await this.lock(path, 'unlink');
			await this.fs.unlink(path);
		}

		public unlinkSync(path: string): void {
			using _ = this.lockSync(path, 'unlink');
			return this.fs.unlinkSync(path);
		}

		public async rmdir(path: string): Promise<void> {
			using _ = await this.lock(path, 'rmdir');
			await this.fs.rmdir(path);
		}

		public rmdirSync(path: string): void {
			using _ = this.lockSync(path, 'rmdir');
			return this.fs.rmdirSync(path);
		}

		public async mkdir(path: string, mode: number): Promise<void> {
			using _ = await this.lock(path, 'mkdir');
			await this.fs.mkdir(path, mode);
		}

		public mkdirSync(path: string, mode: number): void {
			using _ = this.lockSync(path, 'mkdir');
			return this.fs.mkdirSync(path, mode);
		}

		public async readdir(path: string): Promise<string[]> {
			using _ = await this.lock(path, 'readdir');
			return await this.fs.readdir(path);
		}

		public readdirSync(path: string): string[] {
			using _ = this.lockSync(path, 'readdir');
			return this.fs.readdirSync(path);
		}

		public async exists(path: string): Promise<boolean> {
			using _ = await this.lock(path, 'exists');
			return await this.fs.exists(path);
		}

		public existsSync(path: string): boolean {
			using _ = this.lockSync(path, 'exists');
			return this.fs.existsSync(path);
		}

		public async link(srcpath: string, dstpath: string): Promise<void> {
			using _ = await this.lock(srcpath, 'link');
			await this.fs.link(srcpath, dstpath);
		}

		public linkSync(srcpath: string, dstpath: string): void {
			using _ = this.lockSync(srcpath, 'link');
			return this.fs.linkSync(srcpath, dstpath);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			using _ = await this.lock(path, 'sync');
			await this.fs.sync(path, data, stats);
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			using _ = this.lockSync(path, 'sync');
			return this.fs.syncSync(path, data, stats);
		}
		/* eslint-enable @typescript-eslint/no-unused-vars */
	}
	return MutexedFS;
}
