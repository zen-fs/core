import { ErrnoError } from '../error.js';
import type { File } from '../file.js';
import type { FileSystem } from '../filesystem.js';
import '../polyfills.js';
import type { Stats } from '../stats.js';
import type { Mixin } from './shared.js';

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
 * Note: `@ts-expect-error 2513` is needed because `FS` is not properly detected as being concrete
 *
 * @todo Change `using _` to `using void` pending https://github.com/tc39/proposal-discard-binding
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Mutexed<T extends new (...args: any[]) => FileSystem>(
	FS: T
): Mixin<
	T,
	{
		lock(path: string, syscall: string): Promise<MutexLock>;
		lockSync(path: string): MutexLock;
		isLocked(path: string): boolean;
	}
> {
	class MutexedFS extends FS {
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

		/* eslint-disable @typescript-eslint/no-unused-vars */
		public async rename(oldPath: string, newPath: string): Promise<void> {
			using _ = await this.lock(oldPath, 'rename');
			// @ts-expect-error 2513
			await super.rename(oldPath, newPath);
		}

		public renameSync(oldPath: string, newPath: string): void {
			using _ = this.lockSync(oldPath);
			// @ts-expect-error 2513
			return super.renameSync(oldPath, newPath);
		}

		public async stat(path: string): Promise<Stats> {
			using _ = await this.lock(path, 'stat');
			// @ts-expect-error 2513
			return await super.stat(path);
		}

		public statSync(path: string): Stats {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.statSync(path);
		}

		public async openFile(path: string, flag: string): Promise<File> {
			using _ = await this.lock(path, 'openFile');
			// @ts-expect-error 2513
			return await super.openFile(path, flag);
		}

		public openFileSync(path: string, flag: string): File {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.openFileSync(path, flag);
		}

		public async createFile(path: string, flag: string, mode: number): Promise<File> {
			using _ = await this.lock(path, 'createFile');
			// @ts-expect-error 2513
			return await super.createFile(path, flag, mode);
		}

		public createFileSync(path: string, flag: string, mode: number): File {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.createFileSync(path, flag, mode);
		}

		public async unlink(path: string): Promise<void> {
			using _ = await this.lock(path, 'unlink');
			// @ts-expect-error 2513
			await super.unlink(path);
		}

		public unlinkSync(path: string): void {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.unlinkSync(path);
		}

		public async rmdir(path: string): Promise<void> {
			using _ = await this.lock(path, 'rmdir');
			// @ts-expect-error 2513
			await super.rmdir(path);
		}

		public rmdirSync(path: string): void {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.rmdirSync(path);
		}

		public async mkdir(path: string, mode: number): Promise<void> {
			using _ = await this.lock(path, 'mkdir');
			// @ts-expect-error 2513
			await super.mkdir(path, mode);
		}

		public mkdirSync(path: string, mode: number): void {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.mkdirSync(path, mode);
		}

		public async readdir(path: string): Promise<string[]> {
			using _ = await this.lock(path, 'readdir');
			// @ts-expect-error 2513
			return await super.readdir(path);
		}

		public readdirSync(path: string): string[] {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.readdirSync(path);
		}

		public async exists(path: string): Promise<boolean> {
			using _ = await this.lock(path, 'exists');
			return await super.exists(path);
		}

		public existsSync(path: string): boolean {
			using _ = this.lockSync(path);
			return super.existsSync(path);
		}

		public async link(srcpath: string, dstpath: string): Promise<void> {
			using _ = await this.lock(srcpath, 'link');
			// @ts-expect-error 2513
			await super.link(srcpath, dstpath);
		}

		public linkSync(srcpath: string, dstpath: string): void {
			using _ = this.lockSync(srcpath);
			// @ts-expect-error 2513
			return super.linkSync(srcpath, dstpath);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			using _ = await this.lock(path, 'sync');
			// @ts-expect-error 2513
			await super.sync(path, data, stats);
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.syncSync(path, data, stats);
		}
		/* eslint-enable @typescript-eslint/no-unused-vars */
	}
	return MutexedFS;
}
