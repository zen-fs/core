import type { CreationOptions, FileSystem, StreamOptions } from '../internal/filesystem.js';
import type { _AsyncFSKeys, _SyncFSKeys, AsyncFSMethods, Mixin } from './shared.js';

import { withErrno } from 'kerium';
import { crit, debug, err } from 'kerium/log';
import { getAllPrototypes } from 'utilium';
import { StoreFS } from '../backends/store/fs.js';
import { isDirectory, type InodeLike } from '../internal/inode.js';
import { join } from '../path.js';

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
				throw crit(e);
			}
		}

		protected checkSync(): asserts this is { _sync: FileSystem } {
			if (this.attributes.has('no_async')) {
				throw withErrno('ENOTSUP', 'Sync preloading has been disabled for this async file system');
			}
			if (!this._sync) {
				throw crit(withErrno('ENOTSUP', 'No sync cache is attached to this async file system'));
			}
		}

		public renameSync(oldPath: string, newPath: string): void {
			this.checkSync();
			this._sync.renameSync(oldPath, newPath);
			this._async(this.rename(oldPath, newPath));
		}

		public statSync(path: string): InodeLike {
			this.checkSync();
			return this._sync.statSync(path);
		}

		public touchSync(path: string, metadata: InodeLike): void {
			this.checkSync();
			this._sync.touchSync(path, metadata);
			this._async(this.touch(path, metadata));
		}

		public createFileSync(path: string, options: CreationOptions): InodeLike {
			this.checkSync();
			this._async(this.createFile(path, options));
			return this._sync.createFileSync(path, options);
		}

		public unlinkSync(path: string): void {
			this.checkSync();
			this._sync.unlinkSync(path);
			this._async(this.unlink(path));
		}

		public rmdirSync(path: string): void {
			this.checkSync();
			this._sync.rmdirSync(path);
			this._async(this.rmdir(path));
		}

		public mkdirSync(path: string, options: CreationOptions): InodeLike {
			this.checkSync();
			this._async(this.mkdir(path, options));
			return this._sync.mkdirSync(path, options);
		}

		public readdirSync(path: string): string[] {
			this.checkSync();
			return this._sync.readdirSync(path);
		}

		public linkSync(srcpath: string, dstpath: string): void {
			this.checkSync();
			this._sync.linkSync(srcpath, dstpath);
			this._async(this.link(srcpath, dstpath));
		}

		public syncSync(path: string): void {
			this.checkSync();
			this._sync.syncSync(path);
			this._async(this.sync(path));
		}

		public existsSync(path: string): boolean {
			this.checkSync();
			return this._sync.existsSync(path);
		}

		public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
			this.checkSync();
			this._sync.readSync(path, buffer, offset, end);
		}

		public writeSync(path: string, buffer: Uint8Array, offset: number): void {
			this.checkSync();
			this._sync.writeSync(path, buffer, offset);
			this._async(this.write(path, buffer, offset));
		}

		public streamWrite(path: string, options: StreamOptions): WritableStream {
			this.checkSync();
			const sync = this._sync.streamWrite(path, options).getWriter();
			const async = super.streamWrite(path, options).getWriter();

			return new WritableStream({
				async write(chunk, controller) {
					await Promise.all([sync.write(chunk), async.write(chunk)]).catch(controller.error.bind(controller));
				},
				async close() {
					await Promise.all([sync.close(), async.close()]);
				},
				async abort(reason) {
					await Promise.all([sync.abort(reason), async.abort(reason)]);
				},
			});
		}

		/**
		 * @internal
		 */
		protected async crossCopy(path: string): Promise<void> {
			this.checkSync();
			const stats = await this.stat(path);
			if (!isDirectory(stats)) {
				this._sync.createFileSync(path, stats);
				const buffer = new Uint8Array(stats.size);
				await this.read(path, buffer, 0, stats.size);
				this._sync.writeSync(path, buffer, 0);
				this._sync.touchSync(path, stats);
				return;
			}
			if (path !== '/') {
				this._sync.mkdirSync(path, stats);
				this._sync.touchSync(path, stats);
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
						throw err(withErrno(e.errno, e.message + ' (Out of sync!)'));
					}
					return result;
				};
			}
		}
	}

	return AsyncFS;
}
