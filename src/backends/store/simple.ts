import type { Ino } from '../../inode.js';
import { type Store, SyncTransaction } from './store.js';

/**
 * An interface for simple synchronous stores that don't have special support for transactions and such.
 */
export abstract class SimpleSyncStore implements Store {
	public abstract name: string;
	public async sync(): Promise<void> {}
	public async clear(): Promise<void> {
		this.clearSync();
	}
	public abstract clearSync(): void;
	public abstract get(ino: Ino): Uint8Array | undefined;
	public abstract set(ino: Ino, data: Uint8Array): void;
	public abstract delete(ino: Ino): void;
	public beginTransaction(): SimpleTransaction {
		return new SimpleTransaction(this);
	}
}

/**
 * An interface for simple asynchronous stores that don't have special support for transactions and such.
 * This class adds caching at the store level.
 */
export abstract class SimpleAsyncStore extends SimpleSyncStore {
	public abstract name: string;

	protected cache: Map<Ino, Uint8Array> = new Map();

	protected queue: Set<Promise<unknown>> = new Set();

	protected abstract entries(): Promise<Iterable<[Ino, Uint8Array]>>;

	public get(ino: Ino): Uint8Array | undefined {
		return this.cache.get(ino);
	}

	public set(ino: Ino, data: Uint8Array): void {
		this.cache.set(ino, data);
		this.queue.add(this._set(ino, data));
	}

	protected abstract _set(ino: Ino, data: Uint8Array): Promise<void>;

	public delete(ino: Ino): void {
		this.cache.delete(ino);
		this.queue.add(this._delete(ino));
	}

	protected abstract _delete(ino: Ino): Promise<void>;

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

	public beginTransaction(): SimpleTransaction {
		return new SimpleTransaction(this);
	}
}

/**
 * Transaction for simple stores.
 * @see SimpleSyncStore
 * @see SimpleAsyncStore
 */
export class SimpleTransaction extends SyncTransaction {
	/**
	 * Stores data in the keys we modify prior to modifying them.
	 * Allows us to roll back commits.
	 */
	protected originalData: Map<Ino, Uint8Array | void> = new Map();
	/**
	 * List of keys modified in this transaction, if any.
	 */
	protected modifiedKeys: Set<Ino> = new Set();

	constructor(protected store: SimpleSyncStore) {
		super();
	}

	public getSync(ino: Ino): Uint8Array {
		const val = this.store.get(ino);
		this.stashOldValue(ino, val);
		return val!;
	}

	public setSync(ino: Ino, data: Uint8Array): void {
		this.markModified(ino);
		return this.store.set(ino, data);
	}

	public removeSync(ino: Ino): void {
		this.markModified(ino);
		this.store.delete(ino);
	}

	public commitSync(): void {
		/* NOP */
	}

	public abortSync(): void {
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
	}

	/**
	 * Stashes given key value pair into `originalData` if it doesn't already
	 * exist. Allows us to stash values the program is requesting anyway to
	 * prevent needless `get` requests if the program modifies the data later
	 * on during the transaction.
	 */
	protected stashOldValue(ino: Ino, value?: Uint8Array): void {
		// Keep only the earliest value in the transaction.
		if (!this.originalData.has(ino)) {
			this.originalData.set(ino, value);
		}
	}

	/**
	 * Marks the given key as modified, and stashes its value if it has not been
	 * stashed already.
	 */
	protected markModified(ino: Ino): void {
		this.modifiedKeys.add(ino);
		if (!this.originalData.has(ino)) {
			this.originalData.set(ino, this.store.get(ino));
		}
	}
}
