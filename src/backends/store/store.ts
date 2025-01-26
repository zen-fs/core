import { ErrnoError } from '../../error.js';
import '../../polyfills.js';

export type StoreFlag =
	/** The store supports partial reads and writes */
	'partial';

/**
 * Represents a key-value store.
 */
export interface Store {
	/**
	 * The name of the store.
	 */
	readonly name: string;

	/**
	 * Syncs the store
	 */
	sync(): Promise<void>;

	/**
	 * Empties the store completely.
	 */
	clear(): Promise<void> | void;

	/**
	 * Empties the store completely.
	 */
	clearSync(): void;

	/**
	 * Begins a new transaction.
	 */
	transaction(): Transaction;

	/**
	 * Use for optimizations
	 */
	readonly flags: readonly StoreFlag[];
}

/**
 * A transaction for a store.
 */
export abstract class Transaction<T extends Store = Store> {
	public constructor(public readonly store: T) {}

	/**
	 * Gets all of the keys
	 */
	public abstract keys(): Promise<Iterable<number>>;

	/**
	 * Gets all of the keys
	 */
	public abstract keysSync(): Iterable<number>;

	/**
	 * Retrieves data.
	 * @param id The key to look under for data.
	 */
	public abstract get(id: number, offset?: number, end?: number): Promise<Uint8Array | undefined>;

	/**
	 * Retrieves data.
	 * Throws an error if an error occurs or if the key does not exist.
	 * @param id The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	public abstract getSync(id: number, offset?: number, end?: number): Uint8Array | undefined;

	/**
	 * Adds the data to the store under an id. Overwrites any existing data.
	 * @param id The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract set(id: number, data: Uint8Array, offset?: number): Promise<number>;

	/**
	 * Adds the data to the store under and id.
	 * @param id The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract setSync(id: number, data: Uint8Array, offset?: number): number;

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

	/**
	 * Commits the transaction.
	 */
	public abstract commit(): Promise<void>;

	/**
	 * Commits the transaction.
	 */
	public abstract commitSync(): void;

	/**
	 * Aborts and rolls back the transaction.
	 */
	public abstract abort(): Promise<void>;

	/**
	 * Aborts and rolls back the transaction.
	 */
	public abstract abortSync(): void;

	public async [Symbol.asyncDispose]() {
		await this.abort();
	}

	public [Symbol.dispose]() {
		this.abortSync();
	}
}

/**
 * Transaction that implements asynchronous operations with synchronous ones
 */
export abstract class SyncTransaction<T extends Store = Store> extends Transaction<T> {
	/* eslint-disable @typescript-eslint/require-await */
	public async keys(): Promise<Iterable<number>> {
		return this.keysSync();
	}
	public async get(id: number, offset?: number, end?: number): Promise<Uint8Array | undefined> {
		return this.getSync(id, offset, end);
	}

	public async set(id: number, data: Uint8Array, offset?: number): Promise<number> {
		return this.setSync(id, data, offset);
	}

	public async remove(id: number): Promise<void> {
		return this.removeSync(id);
	}

	public async commit(): Promise<void> {
		return this.commitSync();
	}

	public async abort(): Promise<void> {
		return this.abortSync();
	}
	/* eslint-enable @typescript-eslint/require-await */
}

export interface AsyncStore extends Store {
	cache?: Map<number, Uint8Array | undefined>;
}

/**
 * Transaction that implements synchronous operations with a cache
 * @implementors You *must* update the cache and wait for `store.asyncDone` in your asynchronous methods.
 * @todo Make sure we handle abortions correctly, especially since the cache is shared between transactions.
 */
export abstract class AsyncTransaction<T extends AsyncStore = AsyncStore> extends Transaction<T> {
	protected asyncDone: Promise<unknown> = Promise.resolve();

	/** @internal @hidden */
	async(promise: Promise<unknown>): void {
		this.asyncDone = this.asyncDone.then(() => promise);
	}

	/** @internal @hidden */
	cache: Map<number, Uint8Array | undefined> = this.store?.cache ?? new Map();

	public keysSync(): Iterable<number> {
		return this.cache.keys();
	}

	public getSync(id: number, offset: number, end: number): Uint8Array | undefined {
		if (!this.cache.has(id)) return this.cache.get(id);
		this.async(this.get(id, offset, end).then(v => this.cache.set(id, v)));
		throw ErrnoError.With('EAGAIN', undefined, 'AsyncTransaction.getSync');
	}

	public setSync(id: number, data: Uint8Array, offset: number): number {
		this.cache.set(id, data);
		this.async(this.set(id, data, offset));
		return Math.max(this.cache.get(id)?.byteLength || 0, data.byteLength + offset);
	}

	public removeSync(id: number): void {
		this.cache.delete(id);
		this.async(this.remove(id));
	}

	public commitSync(): void {
		this.async(this.commit());
	}

	public abortSync(): void {
		this.async(this.abort());
	}
}

/**
 * Wraps a transaction with the ability to roll-back changes
 * @internal @hidden
 */
export class WrappedTransaction<T extends Store = Store> {
	/**
	 * Whether the transaction was committed or aborted
	 */
	protected done: boolean = false;

	public flag(flag: StoreFlag): boolean {
		return this.raw.store.flags.includes(flag);
	}

	public constructor(public readonly raw: Transaction<T>) {}

	/**
	 * Stores data in the keys we modify prior to modifying them.
	 * Allows us to roll back commits.
	 */
	protected originalData: Map<string, Uint8Array | void> = new Map();

	/**
	 * List of keys modified in this transaction, if any.
	 */
	protected modifiedKeys: Set<string> = new Set();

	public keys(): Promise<Iterable<number>> {
		return this.raw.keys();
	}

	public keysSync(): Iterable<number> {
		return this.raw.keysSync();
	}

	public async get(id: number, offset: number = 0, end?: number): Promise<Uint8Array | undefined> {
		const value = await this.raw.get(id, offset, end);
		this.stash(id, offset, value);
		return value;
	}

	public getSync(id: number, offset: number = 0, end?: number): Uint8Array | undefined {
		const value = this.raw.getSync(id, offset, end);
		this.stash(id, offset, value);
		return value;
	}

	public async set(id: number, data: Uint8Array, offset: number = 0): Promise<number> {
		await this.markModified(id, offset, data.byteLength);
		return await this.raw.set(id, data, offset);
	}

	public setSync(id: number, data: Uint8Array, offset: number = 0): number {
		this.markModifiedSync(id, offset, data.byteLength);
		return this.raw.setSync(id, data, offset);
	}

	public async remove(id: number): Promise<void> {
		await this.markModified(id, 0);
		await this.raw.remove(id);
	}

	public removeSync(id: number): void {
		this.markModifiedSync(id, 0);
		this.raw.removeSync(id);
	}

	public async commit(): Promise<void> {
		await this.raw.commit();
		this.done = true;
	}

	public commitSync(): void {
		this.raw.commitSync();
		this.done = true;
	}

	public async abort(): Promise<void> {
		if (this.done) return;
		// Rollback old values.
		for (const key of this.modifiedKeys) {
			const [id, offset] = key.split('@').map(Number);
			const value = this.originalData.get(key);
			if (!value) {
				// Key didn't exist.
				await this.raw.remove(id);
			} else {
				// Key existed. Store old value.
				await this.raw.set(id, value, offset);
			}
		}
		this.done = true;
	}

	public abortSync(): void {
		if (this.done) return;
		// Rollback old values.
		for (const key of this.modifiedKeys) {
			const [id, offset] = key.split('@').map(Number);
			const value = this.originalData.get(key);
			if (!value) {
				// Key didn't exist.
				this.raw.removeSync(id);
			} else {
				// Key existed. Store old value.
				this.raw.setSync(id, value, offset);
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
	protected stash(id: number, offset: number, value?: Uint8Array): void {
		const key = id + '@' + offset;
		// Keep only the earliest value in the transaction.
		if (!this.originalData.has(key)) {
			this.originalData.set(key, value);
		}
	}

	/**
	 * Marks an id as modified, and stashes its value if it has not been stashed already.
	 */
	protected async markModified(id: number, offset: number, length?: number): Promise<void> {
		const key = id + '@' + offset;
		this.modifiedKeys.add(key);
		if (!this.originalData.has(key)) {
			this.originalData.set(key, await this.raw.get(id, offset, length ? offset + length : undefined));
		}
	}

	/**
	 * Marks an id as modified, and stashes its value if it has not been stashed already.
	 */
	protected markModifiedSync(id: number, offset: number, length?: number): void {
		const key = id + '@' + offset;
		this.modifiedKeys.add(key);
		if (!this.originalData.has(key)) {
			this.originalData.set(key, this.raw.getSync(id, offset, length ? offset + length : undefined));
		}
	}
}
