import type { CreationOptions, FileSystem } from '../internal/filesystem.js';
import type { Stats } from '../stats.js';
import type { _AsyncFSKeys, _SyncFSKeys, AsyncFSMethods, Mixin } from './shared.js';

import { getAllPrototypes } from 'utilium';
import { StoreFS } from '../backends/store/fs.js';
import { Errno, ErrnoError } from '../internal/error.js';
import { LazyFile, parseFlag } from '../internal/file.js';
import { crit, debug, err } from '../internal/log.js';
import { join } from '../vfs/path.js';

/**
 * @internal
 * @category Internals
 */
export type AsyncOperation = {
	[K in keyof AsyncFSMethods]: [K, ...Parameters<FileSystem[K]>];
}[keyof AsyncFSMethods];

/**
 * @internal
 * @category Internals
 */
export interface AsyncMixin extends Pick<FileSystem, Exclude<_SyncFSKeys, 'existsSync'>> {
	/**
	 * @internal @protected
	 */
	_sync?: FileSystem;
	queueDone(): Promise<void>;
	ready(): Promise<void>;
}

/**
 * Async() implements synchronous methods on an asynchronous file system
 *
 * Implementing classes must define `_sync` for the synchronous file system used as a cache.
 *
 * Synchronous methods on an asynchronous FS are implemented by performing operations over the in-memory copy,
 * while asynchronously pipelining them to the backing store.
 * During loading, the contents of the async file system are preloaded into the synchronous store.
 * @category Internals
 */
export function Async<const T extends abstract new (...args: any[]) => FileSystem>(FS: T): Mixin<T, AsyncMixin> {
	abstract class AsyncFS extends FS implements AsyncMixin {
		async done(): Promise<void> {
			await this._promise;
		}

		public queueDone(): Promise<void> {
			return this.done();
		}

		private _promise: Promise<unknown> = Promise.resolve();

		private _async(promise: Promise<unknown>) {
			this._promise = this._promise.then(() => promise);
		}

		private _isInitialized: boolean = false;
		/** Tracks how many updates to the sync. cache we skipped during initialization */
		private _skippedCacheUpdates: number = 0;

		abstract _sync?: FileSystem;

		public constructor(...args: any[]) {
			super(...args);
			this._patchAsync();
		}

		public async ready(): Promise<void> {
			await super.ready();
			await this.queueDone();
			if (this._isInitialized || this.attributes.has('no_async')) return;

			this.checkSync();

			await this._sync.ready();

			// optimization: for 2 storeFS', we copy at a lower abstraction level.
			if (this._sync instanceof StoreFS && this instanceof StoreFS) {
				const sync = this._sync.transaction();
				const async = this.transaction();

				const promises = [];
				for (const key of await async.keys()) {
					promises.push(async.get(key).then(data => sync.setSync(key, data!)));
				}

				await Promise.all(promises);

				this._isInitialized = true;
				return;
			}

			try {
				await this.crossCopy('/');
				debug(`Skipped ${this._skippedCacheUpdates} updates to the sync cache during initialization`);
				this._isInitialized = true;
			} catch (e: any) {
				this._isInitialized = false;
				throw crit(e, { fs: this });
			}
		}

		protected checkSync(path?: string, syscall?: string): asserts this is { _sync: FileSystem } {
			if (this.attributes.has('no_async')) {
				throw crit(new ErrnoError(Errno.ENOTSUP, 'Sync preloading has been disabled for this async file system', path, syscall), {
					fs: this,
				});
			}
			if (!this._sync) {
				throw crit(new ErrnoError(Errno.ENOTSUP, 'No sync cache is attached to this async file system', path, syscall), { fs: this });
			}
		}

		public renameSync(oldPath: string, newPath: string): void {
			this.checkSync(oldPath, 'rename');
			this._sync.renameSync(oldPath, newPath);
			this._async(this.rename(oldPath, newPath));
		}

		public statSync(path: string): Stats {
			this.checkSync(path, 'stat');
			return this._sync.statSync(path);
		}

		public createFileSync(path: string, flag: string, mode: number, options: CreationOptions): LazyFile<this> {
			this.checkSync(path, 'createFile');
			const file = this._sync.createFileSync(path, flag, mode, options);
			this._async(this.createFile(path, flag, mode, options));
			return new LazyFile(this, path, flag, file.statSync());
		}

		public openFileSync(path: string, flag: string): LazyFile<this> {
			this.checkSync(path, 'openFile');
			const stats = this._sync.statSync(path);
			return new LazyFile(this, path, flag, stats);
		}

		public unlinkSync(path: string): void {
			this.checkSync(path, 'unlinkSync');
			this._sync.unlinkSync(path);
			this._async(this.unlink(path));
		}

		public rmdirSync(path: string): void {
			this.checkSync(path, 'rmdir');
			this._sync.rmdirSync(path);
			this._async(this.rmdir(path));
		}

		public mkdirSync(path: string, mode: number, options: CreationOptions): void {
			this.checkSync(path, 'mkdir');
			this._sync.mkdirSync(path, mode, options);
			this._async(this.mkdir(path, mode, options));
		}

		public readdirSync(path: string): string[] {
			this.checkSync(path, 'readdir');
			return this._sync.readdirSync(path);
		}

		public linkSync(srcpath: string, dstpath: string): void {
			this.checkSync(srcpath, 'link');
			this._sync.linkSync(srcpath, dstpath);
			this._async(this.link(srcpath, dstpath));
		}

		public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
			this.checkSync(path, 'sync');
			this._sync.syncSync(path, data, stats);
			this._async(this.sync(path, data, stats));
		}

		public existsSync(path: string): boolean {
			this.checkSync(path, 'exists');
			return this._sync.existsSync(path);
		}

		public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
			this.checkSync(path, 'read');
			this._sync.readSync(path, buffer, offset, end);
		}

		public writeSync(path: string, buffer: Uint8Array, offset: number): void {
			this.checkSync(path, 'write');
			this._sync.writeSync(path, buffer, offset);
			this._async(this.write(path, buffer, offset));
		}

		/**
		 * @internal
		 */
		protected async crossCopy(path: string): Promise<void> {
			this.checkSync(path, 'crossCopy');
			const stats = await this.stat(path);
			if (!stats.isDirectory()) {
				await using asyncFile = await this.openFile(path, parseFlag('r'));
				using syncFile = this._sync.createFileSync(path, parseFlag('w'), stats.mode, stats);
				const buffer = new Uint8Array(stats.size);
				await asyncFile.read(buffer);
				syncFile.writeSync(buffer, 0, stats.size);
				return;
			}
			if (path !== '/') {
				const stats = await this.stat(path);
				this._sync.mkdirSync(path, stats.mode, stats);
			}
			const promises = [];
			for (const file of await this.readdir(path)) {
				promises.push(this.crossCopy(join(path, file)));
			}
			await Promise.all(promises);
		}

		/**
		 * @internal
		 * Patch all async methods to also call their synchronous counterparts unless called from themselves (either sync or async)
		 */
		private _patchAsync(): void {
			const methods = Array.from(getAllPrototypes(this))
				.flatMap(Object.getOwnPropertyNames)
				.filter(key => typeof this[key as keyof this] == 'function' && `${key}Sync` in this) as _AsyncFSKeys[];

			debug('Async: patching methods: ' + methods.join(', '));

			for (const key of methods) {
				// TS does not narrow the union based on the key
				const originalMethod = this[key] as (...args: unknown[]) => Promise<unknown>;

				(this as any)[key] = async (...args: unknown[]) => {
					const result = await originalMethod.apply(this, args);

					const stack = new Error().stack?.split('\n').slice(2).join('\n');
					// !stack == From the async queue
					if (stack?.includes(`at <computed> [as ${key}]`) || stack?.includes(`${key}Sync `) || !stack) return result;

					if (!this._isInitialized) {
						this._skippedCacheUpdates++;
						return result;
					}

					try {
						// @ts-expect-error 2556 - The type of `args` is not narrowed
						this._sync?.[`${key}Sync`]?.(...args);
					} catch (e: any) {
						throw err(new ErrnoError(e.errno, e.message + ' (Out of sync!)', e.path, key), { fs: this });
					}
					return result;
				};
			}
		}
	}

	return AsyncFS;
}
