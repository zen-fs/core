import { SyncTransaction, type Store } from './store.js';

/**
 * An interface for simple synchronous stores that don't have special support for transactions and such.
 */
export interface SimpleSyncStore extends Store {
	keys(): Iterable<number>;
	get(id: number): Uint8Array | undefined;
	set(id: number, data: Uint8Array, isMetadata?: boolean): void;
	delete(id: number): void;
}

/**
 * An interface for simple asynchronous stores that don't have special support for transactions and such.
 * This class adds caching at the store level.
 */
export abstract class SimpleAsyncStore implements SimpleSyncStore {
	public abstract name: string;

	protected cache: Map<number, Uint8Array> = new Map();

	protected queue: Set<Promise<unknown>> = new Set();

	protected abstract entries(): Promise<Iterable<[number, Uint8Array]>>;

	public keys(): Iterable<number> {
		return this.cache.keys();
	}

	public get(id: number): Uint8Array | undefined {
		return this.cache.get(id);
	}

	public set(id: number, data: Uint8Array): void {
		this.cache.set(id, data);
		this.queue.add(this._set(id, data));
	}

	protected abstract _set(ino: number, data: Uint8Array): Promise<void>;

	public delete(id: number): void {
		this.cache.delete(id);
		this.queue.add(this._delete(id));
	}

	protected abstract _delete(ino: number): Promise<void>;

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
	protected originalData: Map<number, Uint8Array | void> = new Map();
	/**
	 * List of keys modified in this transaction, if any.
	 */
	protected modifiedKeys: Set<number> = new Set();

	protected declare store: SimpleSyncStore;

	public keysSync(): Iterable<number> {
		return this.store.keys();
	}

	public getSync(id: number): Uint8Array | undefined {
		const val = this.store.get(id);
		this.stashOldValue(id, val);
		return val;
	}

	public setSync(id: number, data: Uint8Array, isMetadata?: boolean): void {
		this.markModified(id);
		return this.store.set(id, data, isMetadata);
	}

	public removeSync(id: number): void {
		this.markModified(id);
		this.store.delete(id);
	}

	public commitSync(): void {
		this.done = true;
	}

	public abortSync(): void {
		if (this.done) return;
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
	protected stashOldValue(id: number, value?: Uint8Array): void {
		// Keep only the earliest value in the transaction.
		if (!this.originalData.has(id)) {
			this.originalData.set(id, value);
		}
	}

	/**
	 * Marks `ino` as modified, and stashes its value if it has not been
	 * stashed already.
	 */
	protected markModified(id: number): void {
		this.modifiedKeys.add(id);
		if (!this.originalData.has(id)) {
			this.originalData.set(id, this.store.get(id));
		}
	}
}
