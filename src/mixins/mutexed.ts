import type { Cred } from '../cred.js';
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
		lock(path: string): Promise<MutexLock>;
		lockSync(path: string): MutexLock;
		isLocked(path: string): boolean;
	}
> {
	class MutexedFS extends FS {
		/**
		 * The current locks
		 */
		private locks: Map<string, MutexLock> = new Map();
		private inLockedThread: boolean = false;

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
			if (this.inLockedThread) {
				const previous = this.locks.get(path);
				this.inLockedThread = false;
				const lock = this.addLock(path);
				await previous?.done();
				return lock;
			} else return this.locks.get(path)!;
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
		public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
			using _ = await this.lock(oldPath);
			// @ts-expect-error 2513
			await super.rename(oldPath, newPath, cred);
		}

		public renameSync(oldPath: string, newPath: string, cred: Cred): void {
			using _ = this.lockSync(oldPath);
			// @ts-expect-error 2513
			return super.renameSync(oldPath, newPath, cred);
		}

		public async stat(path: string, cred: Cred): Promise<Stats> {
			using _ = await this.lock(path);
			// @ts-expect-error 2513
			return await super.stat(path, cred);
		}

		public statSync(path: string, cred: Cred): Stats {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.statSync(path, cred);
		}

		public async openFile(path: string, flag: string, cred: Cred): Promise<File> {
			using _ = await this.lock(path);
			// @ts-expect-error 2513
			return await super.openFile(path, flag, cred);
		}

		public openFileSync(path: string, flag: string, cred: Cred): File {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.openFileSync(path, flag, cred);
		}

		public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
			using _ = await this.lock(path);
			// @ts-expect-error 2513
			return await super.createFile(path, flag, mode, cred);
		}

		public createFileSync(path: string, flag: string, mode: number, cred: Cred): File {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.createFileSync(path, flag, mode, cred);
		}

		public async unlink(path: string, cred: Cred): Promise<void> {
			using _ = await this.lock(path);
			// @ts-expect-error 2513
			await super.unlink(path, cred);
		}

		public unlinkSync(path: string, cred: Cred): void {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.unlinkSync(path, cred);
		}

		public async rmdir(path: string, cred: Cred): Promise<void> {
			using _ = await this.lock(path);
			// @ts-expect-error 2513
			await super.rmdir(path, cred);
		}

		public rmdirSync(path: string, cred: Cred): void {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.rmdirSync(path, cred);
		}

		public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
			using _ = await this.lock(path);
			// @ts-expect-error 2513
			await super.mkdir(path, mode, cred);
		}

		public mkdirSync(path: string, mode: number, cred: Cred): void {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.mkdirSync(path, mode, cred);
		}

		public async readdir(path: string, cred: Cred): Promise<string[]> {
			using _ = await this.lock(path);
			// @ts-expect-error 2513
			return await super.readdir(path, cred);
		}

		public readdirSync(path: string, cred: Cred): string[] {
			using _ = this.lockSync(path);
			// @ts-expect-error 2513
			return super.readdirSync(path, cred);
		}

		public async exists(path: string, cred: Cred): Promise<boolean> {
			using _ = await this.lock(path);
			return await super.exists(path, cred);
		}

		public existsSync(path: string, cred: Cred): boolean {
			using _ = this.lockSync(path);
			return super.existsSync(path, cred);
		}

		public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
			using _ = await this.lock(srcpath);
			// @ts-expect-error 2513
			await super.link(srcpath, dstpath, cred);
		}

		public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
			using _ = this.lockSync(srcpath);
			// @ts-expect-error 2513
			return super.linkSync(srcpath, dstpath, cred);
		}

		public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
			using _ = await this.lock(path);
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
