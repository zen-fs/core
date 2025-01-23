import { ErrnoError } from '../../error.js';
import '../../polyfills.js';
import { _throw } from '../../utils.js';

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
}

/**
 * A transaction for a store.
 */
export abstract class Transaction<T extends Store = Store> {
	public constructor(protected store: T) {}

	/**
	 * Whether the transaction was committed or aborted
	 */
	protected done: boolean = false;

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
	public abstract get(id: number): Promise<Uint8Array | undefined>;

	/**
	 * Retrieves data.
	 * Throws an error if an error occurs or if the key does not exist.
	 * @param id The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	public abstract getSync(id: number): Uint8Array | undefined;

	/**
	 * Adds the data to the store under an id. Overwrites any existing data.
	 * @param id The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract set(id: number, data: Uint8Array): Promise<void>;

	/**
	 * Adds the data to the store under and id.
	 * @param id The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract setSync(id: number, data: Uint8Array): void;

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

	public async [Symbol.asyncDispose]() {
		if (this.done) return;

		await this.abort();
	}

	/**
	 * Commits the transaction.
	 */
	public abstract commitSync(): void;

	public [Symbol.dispose]() {
		if (this.done) return;

		this.abortSync();
	}

	/**
	 * Aborts and rolls back the transaction.
	 */
	public abstract abort(): Promise<void>;

	/**
	 * Aborts and rolls back the transaction.
	 */
	public abstract abortSync(): void;
}

/**
 * Transaction that implements asynchronous operations with synchronous ones
 */
export abstract class SyncTransaction<T extends Store = Store> extends Transaction<T> {
	/* eslint-disable @typescript-eslint/require-await */
	public async keys(): Promise<Iterable<number>> {
		return this.keysSync();
	}
	public async get(id: number): Promise<Uint8Array | undefined> {
		return this.getSync(id);
	}

	public async set(id: number, data: Uint8Array): Promise<void> {
		return this.setSync(id, data);
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

/**
 * Store that implements synchronous operations with a cache
 */
export abstract class AsyncStore implements Store {
	protected asyncDone: Promise<unknown> = Promise.resolve();

	/** @internal @hidden */
	async(promise: Promise<unknown>): void {
		this.asyncDone = this.asyncDone.then(() => promise);
	}

	/** @internal @hidden */
	cache = new Map<number, Uint8Array | undefined>();

	/**
	 * Used by synchronous operations to check whether to return undefined or EAGAIN.
	 * @internal @hidden
	 */
	_keys?: number[];

	clearSync(): void {
		this.async(this.clear());
	}

	abstract name: string;
	abstract sync(): Promise<void>;
	abstract clear(): Promise<void>;
	abstract transaction(): AsyncTransaction<this>;
}

/**
 * Transaction that implements synchronous operations with a cache
 * @implementors You *must* update the cache in your asynchronous methods and wait for `store.asyncDone`.
 * @todo Make sure we handle abortions correctly,
 * especially since the cache is shared between transactions.
 */
export abstract class AsyncTransaction<T extends AsyncStore = AsyncStore> extends Transaction<T> {
	public constructor(store: T) {
		super(store);
	}

	public keysSync(): Iterable<number> {
		return this.store._keys ?? _throw(ErrnoError.With('ENOTSUP', undefined, 'AsyncTransaction.keysSync'));
	}

	public getSync(id: number): Uint8Array | undefined {
		if (!this.store._keys?.includes(id)) {
			this.store.async(this.get(id).then(v => this.store.cache.set(id, v)));
			throw ErrnoError.With('EAGAIN', undefined, 'AsyncTransaction.getSync');
		}

		return this.store.cache.get(id);
	}

	public setSync(id: number, data: Uint8Array): void {
		this.store.cache.set(id, data);
		this.store.async(this.set(id, data));
	}

	public removeSync(id: number): void {
		this.store.cache.delete(id);
		this.store.async(this.remove(id));
	}

	public commitSync(): void {
		this.store.async(this.commit());
	}

	public abortSync(): void {
		this.store.async(this.abort());
	}
}
