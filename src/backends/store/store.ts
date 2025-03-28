import { withErrno } from 'kerium';
import { err, warn } from 'kerium/log';
import type { UUID } from 'node:crypto';
import { Resource } from 'utilium/cache.js';
import type { UsageInfo } from '../../internal/filesystem.js';
import '../../polyfills.js';
import type { StoreFS } from './fs.js';

/**
 * @category Stores and Transactions
 */
export type StoreFlag =
	/** The store supports partial reads and writes */
	'partial';

/**
 * Represents a key-value store.
 * @category Stores and Transactions
 */
export interface Store {
	/**
	 * @see FileSystem#id
	 */
	readonly type?: number;

	/**
	 * What the file system using this store should be called.
	 * For example, tmpfs for an in memory store
	 */
	readonly name: string;

	/**
	 * A name for this instance of the store.
	 * For example, you might use a share name for a network-based store
	 */
	readonly label?: string;

	/**
	 * A UUID for this instance of the store.
	 */
	readonly uuid?: UUID;

	/**
	 * Syncs the store
	 */
	sync(): Promise<void>;

	/**
	 * Begins a new transaction.
	 */
	transaction(): Transaction;

	/**
	 * Use for optimizations
	 */
	readonly flags?: readonly StoreFlag[];

	/**
	 * Usage information for the store
	 */
	usage?(): UsageInfo;

	/**
	 * @internal @hidden
	 */
	_fs?: StoreFS;
}

/**
 * A transaction for a store.
 * @category Stores and Transactions
 */
export abstract class Transaction<T extends Store = Store> {
	public constructor(public readonly store: T) {}

	/**
	 * Gets all of the keys
	 */
	public abstract keys(): Promise<Iterable<number>>;

	/**
	 * Retrieves data.
	 * @param id The key to look under for data.
	 */
	public abstract get(id: number, offset: number, end?: number): Promise<Uint8Array | undefined>;

	/**
	 * Retrieves data.
	 * Throws an error if an error occurs or if the key does not exist.
	 * @param id The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	public abstract getSync(id: number, offset: number, end?: number): Uint8Array | undefined;

	/**
	 * Adds the data to the store under an id. Overwrites any existing data.
	 * @param id The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract set(id: number, data: Uint8Array, offset: number): Promise<void>;

	/**
	 * Adds the data to the store under and id.
	 * @param id The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract setSync(id: number, data: Uint8Array, offset: number): void;

	/**
	 * Deletes the data at `ino`.
	 * @param id The key to delete from the store.
	 */
	public abstract remove(id: number): Promise<void>;

	/**
	 * Deletes the data at `ino`.
	 * @param id The key to delete from the store.
	 */
	public abstract removeSync(id: number): void;
}

/**
 * Transaction that implements asynchronous operations with synchronous ones
 * @category Stores and Transactions
 */
export abstract class SyncTransaction<T extends Store = Store> extends Transaction<T> {
	/* eslint-disable @typescript-eslint/require-await */

	public async get(id: number, offset: number, end?: number): Promise<Uint8Array | undefined> {
		return this.getSync(id, offset, end);
	}

	public async set(id: number, data: Uint8Array, offset: number): Promise<void> {
		return this.setSync(id, data, offset);
	}

	public async remove(id: number): Promise<void> {
		return this.removeSync(id);
	}

	/* eslint-enable @typescript-eslint/require-await */
}

/**
 * @category Stores and Transactions
 */
export interface AsyncStore extends Store {
	cache?: Map<number, Resource<number>>;
}

/**
 * Transaction that implements synchronous operations with a cache
 * Implementors: You *must* update the cache and wait for `store.asyncDone` in your asynchronous methods.
 * @todo Make sure we handle abortions correctly, especially since the cache is shared between transactions.
 * @category Stores and Transactions
 */
export abstract class AsyncTransaction<T extends AsyncStore = AsyncStore> extends Transaction<T> {
	protected asyncDone: Promise<unknown> = Promise.resolve();

	/**
	 * Run a asynchronous operation from a sync context. Not magic and subject to (race) conditions.
	 * @internal
	 */
	protected async(promise: Promise<unknown>): void {
		this.asyncDone = this.asyncDone.then(() => promise);
	}

	/**
	 * Gets a cache resource
	 * If `info` is set and the resource doesn't exist, it will be created
	 * @internal
	 */
	_cached(id: number, info?: { size: number }) {
		this.store.cache ??= new Map();
		const resource = this.store.cache.get(id);
		if (!resource) return !info ? undefined : new Resource(id, info.size, {}, this.store.cache);
		if (info) resource.size = info.size;
		return resource;
	}

	public getSync(id: number, offset: number, end?: number): Uint8Array | undefined {
		const resource = this._cached(id);
		if (!resource) return;

		end ??= resource.size;
		const missing = resource.missing(offset, end);
		for (const { start, end } of missing) {
			this.async(this.get(id, start, end));
		}

		if (missing.length) throw withErrno('EAGAIN');

		const region = resource.regionAt(offset);

		if (!region) {
			warn('Missing cache region for ' + id);
			return;
		}

		return region.data.subarray(offset - region.offset, end - region.offset);
	}

	public setSync(id: number, data: Uint8Array, offset: number): void {
		this.async(this.set(id, data, offset));
	}

	public removeSync(id: number): void {
		this.async(this.remove(id));

		this.store.cache?.delete(id);
	}
}

/**
 * Wraps a transaction with the ability to roll-back changes, among other things.
 * This is used by `StoreFS`
 * @category Stores and Transactions
 * @internal @hidden
 */
export class WrappedTransaction<T extends Store = Store> {
	/**
	 * Whether the transaction was committed or aborted
	 */
	protected done: boolean = false;

	public flag(flag: StoreFlag): boolean {
		return this.raw.store.flags?.includes(flag) ?? false;
	}

	public constructor(
		public readonly raw: Transaction<T>,
		protected fs: StoreFS<T>
	) {}

	/**
	 * Stores data in the keys we modify prior to modifying them.
	 * Allows us to roll back commits.
	 */
	protected originalData: Map<number, { data?: Uint8Array; offset: number }[]> = new Map();

	/**TransactionEntry
	 * List of keys modified in this transaction, if any.
	 */
	protected modifiedKeys: Set<number> = new Set();

	public keys(): Promise<Iterable<number>> {
		return this.raw.keys();
	}

	public async get(id: number, offset: number = 0, end?: number): Promise<Uint8Array | undefined> {
		const data = await this.raw.get(id, offset, end);
		this.stash(id);
		return data;
	}

	public getSync(id: number, offset: number = 0, end?: number): Uint8Array | undefined {
		const data = this.raw.getSync(id, offset, end);
		this.stash(id);
		return data;
	}

	public async set(id: number, data: Uint8Array, offset: number = 0): Promise<void> {
		await this.markModified(id, offset, data.byteLength);
		await this.raw.set(id, data, offset);
	}

	public setSync(id: number, data: Uint8Array, offset: number = 0): void {
		this.markModifiedSync(id, offset, data.byteLength);
		this.raw.setSync(id, data, offset);
	}

	public async remove(id: number): Promise<void> {
		await this.markModified(id, 0, undefined);
		await this.raw.remove(id);
	}

	public removeSync(id: number): void {
		this.markModifiedSync(id, 0, undefined);
		this.raw.removeSync(id);
	}

	public commit(): Promise<void> {
		this.done = true;
		return Promise.resolve();
	}

	public commitSync(): void {
		this.done = true;
	}

	public async abort(): Promise<void> {
		if (this.done) return;
		// Rollback old values.
		for (const [id, entries] of this.originalData) {
			if (!this.modifiedKeys.has(id)) continue;

			// Key didn't exist.
			if (entries.some(ent => !ent.data)) {
				await this.raw.remove(id);
				this.fs._remove(id);
				continue;
			}

			for (const entry of entries.reverse()) {
				await this.raw.set(id, entry.data!, entry.offset);
			}
		}
		this.done = true;
	}

	public abortSync(): void {
		if (this.done) return;
		// Rollback old values.
		for (const [id, entries] of this.originalData) {
			if (!this.modifiedKeys.has(id)) continue;

			// Key didn't exist.
			if (entries.some(ent => !ent.data)) {
				this.raw.removeSync(id);
				this.fs._remove(id);
				continue;
			}

			for (const entry of entries.reverse()) {
				this.raw.setSync(id, entry.data!, entry.offset);
			}
		}
		this.done = true;
	}

	public async [Symbol.asyncDispose]() {
		if (this.done) return;

		await this.abort();
	}

	public [Symbol.dispose]() {
		if (this.done) return;

		this.abortSync();
	}

	/**
	 * Stashes given key value pair into `originalData` if it doesn't already exist.
	 * Allows us to stash values the program is requesting anyway to
	 * prevent needless `get` requests if the program modifies the data later
	 * on during the transaction.
	 */
	protected stash(id: number, data?: Uint8Array, offset: number = 0): void {
		if (!this.originalData.has(id)) this.originalData.set(id, []);
		this.originalData.get(id)!.push({ data, offset });
	}

	/**
	 * Marks an id as modified, and stashes its value if it has not been stashed already.
	 */
	protected async markModified(id: number, offset: number, length?: number): Promise<void> {
		this.modifiedKeys.add(id);
		const end = length ? offset + length : undefined;
		try {
			this.stash(id, await this.raw.get(id, offset, end), offset);
		} catch (e) {
			if (!(this.raw instanceof AsyncTransaction)) throw e;

			/*
				async transaction has a quirk:
				setting the buffer to a larger size doesn't work correctly due to cache ranges
				so, we cache the existing sub-ranges
			*/

			const tx = this.raw as AsyncTransaction<AsyncStore>;
			const resource = tx._cached(id);
			if (!resource) throw e;

			for (const range of resource.cached(offset, end ?? offset)) {
				this.stash(id, await this.raw.get(id, range.start, range.end), range.start);
			}
		}
	}

	/**
	 * Marks an id as modified, and stashes its value if it has not been stashed already.
	 */
	protected markModifiedSync(id: number, offset: number, length?: number): void {
		this.modifiedKeys.add(id);
		const end = length ? offset + length : undefined;

		try {
			this.stash(id, this.raw.getSync(id, offset, end), offset);
		} catch (e) {
			if (!(this.raw instanceof AsyncTransaction)) throw e;

			/*
				async transaction has a quirk:
				setting the buffer to a larger size doesn't work correctly due to cache ranges
				so, we cache the existing sub-ranges
			*/

			const tx = this.raw as AsyncTransaction<AsyncStore>;
			const resource = tx._cached(id);
			if (!resource) throw e;

			for (const range of resource.cached(offset, end ?? offset)) {
				this.stash(id, this.raw.getSync(id, range.start, range.end), range.start);
			}
		}
	}
}
