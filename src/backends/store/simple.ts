import { SyncTransaction, type Store } from './store.js';

/**
 * An interface for simple synchronous stores that don't have special support for transactions and such.
 */
export interface SimpleSyncStore extends Store {
	keys(): Iterable<bigint>;
	get(id: bigint): Uint8Array | undefined;
	set(id: bigint, data: Uint8Array): void;
	delete(id: bigint): void;
}

/**
 * An interface for simple asynchronous stores that don't have special support for transactions and such.
 * This class adds caching at the store level.
 */
export abstract class SimpleAsyncStore implements SimpleSyncStore {
	public abstract name: string;

	protected cache: Map<bigint, Uint8Array> = new Map();

	protected queue: Set<Promise<unknown>> = new Set();

	protected abstract entries(): Promise<Iterable<[bigint, Uint8Array]>>;

	public keys(): Iterable<bigint> {
		return this.cache.keys();
	}

	public get(id: bigint): Uint8Array | undefined {
		return this.cache.get(id);
	}

	public set(id: bigint, data: Uint8Array): void {
		this.cache.set(id, data);
		this.queue.add(this._set(id, data));
	}

	protected abstract _set(ino: bigint, data: Uint8Array): Promise<void>;

	public delete(id: bigint): void {
		this.cache.delete(id);
		this.queue.add(this._delete(id));
	}

	protected abstract _delete(ino: bigint): Promise<void>;

	public clearSync(): void {
		this.cache.clear();
		this.queue.add(this.clear());
	}

	public abstract clear(): Promise<void>;

	public async sync(): Promise<void> {
		for (const [ino, data] of await this.entries()) {
			if (!this.cache.has(ino)) {
				this.cache.set(ino, data);
			}
		}
		for (const promise of this.queue) {
			await promise;
		}
	}

	public transaction(): SimpleTransaction {
		return new SimpleTransaction(this);
	}
}

/**
 * Transaction for simple stores.
 * @see SimpleSyncStore
 * @see SimpleAsyncStore
 */
export class SimpleTransaction extends SyncTransaction<SimpleSyncStore> {
	/**
	 * Stores data in the keys we modify prior to modifying them.
	 * Allows us to roll back commits.
	 */
	protected originalData: Map<bigint, Uint8Array | void> = new Map();
	/**
	 * List of keys modified in this transaction, if any.
	 */
	protected modifiedKeys: Set<bigint> = new Set();

	protected declare store: SimpleSyncStore;

	public keysSync(): Iterable<bigint> {
		return this.store.keys();
	}

	public getSync(id: bigint): Uint8Array {
		const val = this.store.get(id);
		this.stashOldValue(id, val);
		return val!;
	}

	public setSync(id: bigint, data: Uint8Array): void {
		this.markModified(id);
		return this.store.set(id, data);
	}

	public removeSync(id: bigint): void {
		this.markModified(id);
		this.store.delete(id);
	}

	public commitSync(): void {
		this.done = true;
	}

	public abortSync(): void {
		if (!this.done) {
			return;
		}
		// Rollback old values.
		for (const key of this.modifiedKeys) {
			const value = this.originalData.get(key);
			if (!value) {
				// Key didn't exist.
				this.store.delete(key);
			} else {
				// Key existed. Store old value.
				this.store.set(key, value);
			}
		}
		this.done = true;
	}

	/**
	 * Stashes given key value pair into `originalData` if it doesn't already
	 * exist. Allows us to stash values the program is requesting anyway to
	 * prevent needless `get` requests if the program modifies the data later
	 * on during the transaction.
	 */
	protected stashOldValue(id: bigint, value?: Uint8Array): void {
		// Keep only the earliest value in the transaction.
		if (!this.originalData.has(id)) {
			this.originalData.set(id, value);
		}
	}

	/**
	 * Marks `ino` as modified, and stashes its value if it has not been
	 * stashed already.
	 */
	protected markModified(id: bigint): void {
		this.modifiedKeys.add(id);
		if (!this.originalData.has(id)) {
			this.originalData.set(id, this.store.get(id));
		}
	}
}
