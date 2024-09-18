import { join } from '../emulation/path.js';
import { Errno, ErrnoError } from '../error.js';
import { parseFlag, PreloadFile, type File } from '../file.js';
import type { FileSystem } from '../filesystem.js';
import type { Stats } from '../stats.js';
import type { _AsyncFSMethods, Mixin } from './shared.js';

/**
 * @internal
 */
export type AsyncOperation = {
	[K in keyof _AsyncFSMethods]: [K, ...Parameters<FileSystem[K]>];
}[keyof _AsyncFSMethods];

/**
 * Async() implements synchronous methods on an asynchronous file system
 *
 * Implementing classes must define `_sync` for the synchronous file system used as a cache.
 *
 * Synchronous methods on an asynchronous FS are implemented by performing operations over the in-memory copy,
 * while asynchronously pipelining them to the backing store.
 * During loading, the contents of the async file system are preloaded into the synchronous store.
 *
 */
export function Async<T extends typeof FileSystem>(
	FS: T
): Mixin<
	T,
	{
		/**
		 * @internal @protected
		 */
		_sync?: FileSystem;
		queueDone(): Promise<void>;
		ready(): Promise<void>;
		renameSync(oldPath: string, newPath: string): void;
		statSync(path: string): Stats;
		createFileSync(path: string, flag: string, mode: number): File;
		openFileSync(path: string, flag: string): File;
		unlinkSync(path: string): void;
		rmdirSync(path: string): void;
		mkdirSync(path: string, mode: number): void;
		readdirSync(path: string): string[];
		linkSync(srcpath: string, dstpath: string): void;
		syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void;
	}
> {
	abstract class AsyncFS extends FS {
		/**
		 * Queue of pending asynchronous operations.
		 */
		private _queue: AsyncOperation[] = [];
		private get _queueRunning(): boolean {
			return !!this._queue.length;
		}

		public queueDone(): Promise<void> {
			return new Promise(resolve => {
				const check = (): unknown => (this._queueRunning ? setTimeout(check) : resolve());
				check();
			});
		}

		private _isInitialized: boolean = false;

		abstract _sync?: FileSystem;

		public async ready(): Promise<void> {
			await super.ready();
			if (this._isInitialized || this._disableSync) {
				return;
			}
			this.checkSync();

			await this._sync.ready();

			try {
				await this.crossCopy('/');
				this._isInitialized = true;
			} catch (e) {
				this._isInitialized = false;
				throw e;
			}
		}

		protected checkSync(path?: string, syscall?: string): asserts this is { _sync: FileSystem } {
			if (this._disableSync) {
				throw new ErrnoError(Errno.ENOTSUP, 'Sync caching has been disabled for this async file system', path, syscall);
			}
			if (!this._sync) {
				throw new ErrnoError(Errno.ENOTSUP, 'No sync cache is attached to this async file system', path, syscall);
			}
		}

		public renameSync(oldPath: string, newPath: string): void {
			this.checkSync(oldPath, 'rename');
			this._sync.renameSync(oldPath, newPath);
			this.queue('rename', oldPath, newPath);
		}

		public statSync(path: string): Stats {
			this.checkSync(path, 'stat');
			return this._sync.statSync(path);
		}

		public createFileSync(path: string, flag: string, mode: number): PreloadFile<this> {
			this.checkSync(path, 'createFile');
			this._sync.createFileSync(path, flag, mode);
			this.queue('createFile', path, flag, mode);
			return this.openFileSync(path, flag);
		}

		public openFileSync(path: string, flag: string): PreloadFile<this> {
			this.checkSync(path, 'openFile');
			const file = this._sync.openFileSync(path, flag);
			const stats = file.statSync();
			const buffer = new Uint8Array(stats.size);
			file.readSync(buffer);
			return new PreloadFile(this, path, flag, stats, buffer);
		}

		public unlinkSync(path: string): void {
			this.checkSync(path, 'unlinkSync');
			this._sync.unlinkSync(path);
			this.queue('unlink', path);
		}

		public rmdirSync(path: string): void {
			this.checkSync(path, 'rmdir');
			this._sync.rmdirSync(path);
			this.queue('rmdir', path);
		}

		public mkdirSync(path: string, mode: number): void {
			this.checkSync(path, 'mkdir');
			this._sync.mkdirSync(path, mode);
			this.queue('mkdir', path, mode);
		}

		public readdirSync(path: string): string[] {
			this.checkSync(path, 'readdir');
			return this._sync.readdirSync(path);
		}

		public linkSync(srcpath: string, dstpath: string): void {
			this.checkSync(srcpath, 'link');
			this._sync.linkSync(srcpath, dstpath);
			this.queue('link', srcpath, dstpath);
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			this.checkSync(path, 'sync');
			this._sync.syncSync(path, data, stats);
			this.queue('sync', path, data, stats);
		}

		public existsSync(path: string): boolean {
			this.checkSync(path, 'exists');
			return this._sync.existsSync(path);
		}

		/**
		 * @internal
		 */
		protected async crossCopy(path: string): Promise<void> {
			this.checkSync(path, 'crossCopy');
			const stats = await this.stat(path);
			if (!stats.isDirectory()) {
				await using asyncFile = await this.openFile(path, parseFlag('r'));
				using syncFile = this._sync.createFileSync(path, parseFlag('w'), stats.mode);
				const buffer = new Uint8Array(stats.size);
				await asyncFile.read(buffer);
				syncFile.writeSync(buffer, 0, stats.size);
				return;
			}
			if (path !== '/') {
				const stats = await this.stat(path);
				this._sync.mkdirSync(path, stats.mode);
			}
			const files = await this.readdir(path);
			for (const file of files) {
				await this.crossCopy(join(path, file));
			}
		}

		/**
		 * @internal
		 */
		private async _next(): Promise<void> {
			if (!this._queueRunning) {
				return;
			}

			const [method, ...args] = this._queue.shift()!;
			// @ts-expect-error 2556 (since ...args is not correctly picked up as being a tuple)
			await this[method](...args);
			await this._next();
		}

		/**
		 * @internal
		 */
		private queue(...op: AsyncOperation) {
			this._queue.push(op);
			void this._next();
		}
	}

	return AsyncFS;
}
