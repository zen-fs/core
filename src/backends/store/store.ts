import type { Ino } from '../../inode.js';

/**
 * Represents a key-value store.
 */
export interface Store {
	/**
	 * The name of the store.
	 */
	name: string;

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
	 * Get all of the entries in a store
	 */
	entries(): Iterable<[Ino, Uint8Array]> | Promise<Iterable<[Ino, Uint8Array]>>;
}

/**
 * A transaction for a synchronous store.
 */
export abstract class Transaction<T extends Store = Store> {
	constructor(protected store: T) {}

	protected aborted: boolean = false;

	/**
	 * Retrieves the data at the given key.
	 * @param ino The key to look under for data.
	 */
	public abstract get(ino: Ino): Promise<Uint8Array>;

	/**
	 * Retrieves the data at the given key. Throws an error if an error occurs
	 * or if the key does not exist.
	 * @param ino The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	public abstract getSync(ino: Ino): Uint8Array;

	/**
	 * Adds the data to the store under the given key. Overwrites any existing
	 * data.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids writing the data if the key exists.
	 */
	public abstract set(ino: Ino, data: Uint8Array): Promise<void>;

	/**
	 * Adds the data to the store under the given key.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids storing the data if the key exists.
	 * @return True if storage succeeded, false otherwise.
	 */
	public abstract setSync(ino: Ino, data: Uint8Array): void;

	/**
	 * Deletes the data at the given key.
	 * @param ino The key to delete from the store.
	 */
	public abstract remove(ino: Ino): Promise<void>;

	/**
	 * Deletes the data at the given key.
	 * @param ino The key to delete from the store.
	 */
	public abstract removeSync(ino: Ino): void;

	/**
	 * Commits the transaction.
	 */
	public abstract commit(): Promise<void>;

	public async [Symbol.asyncDispose]() {
		if (this.aborted) {
			return;
		}

		await this.commit();
	}

	/**
	 * Commits the transaction.
	 */
	public abstract commitSync(): void;

	public [Symbol.dispose]() {
		if (this.aborted) {
			return;
		}

		this.commitSync();
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
	public async init(): Promise<void> {}
	public async get(ino: Ino): Promise<Uint8Array> {
		return this.getSync(ino);
	}
	public async set(ino: bigint, data: Uint8Array): Promise<void> {
		return this.setSync(ino, data);
	}
	public async remove(ino: Ino): Promise<void> {
		return this.removeSync(ino);
	}
	public async commit(): Promise<void> {
		return this.commitSync();
	}
	public async abort(): Promise<void> {
		return this.abortSync();
	}
}

/**
 * Transaction that only supports asynchronous operations
 * @todo ensure this works with `disableAsyncCache`
 */
export abstract class AsyncTransaction<T extends Store = Store> extends Transaction<T> {
	protected cache: Map<Ino, Uint8Array> = new Map();
	protected queue: Promise<unknown>[] = [];

	public async init(): Promise<void> {
		for (const [key, value] of await this.store.entries()) {
			this.cache.set(key, value);
		}
	}
	public getSync(ino: Ino): Uint8Array {
		return this.cache.get(ino)!;
	}
	public setSync(ino: Ino, data: Uint8Array): void {
		this.cache.set(ino, data);
		this.queue.push(this.set(ino, data));
	}
	public removeSync(ino: Ino): void {
		this.cache.delete(ino);
		this.queue.push(this.remove(ino));
	}
	public commitSync(): void {
		this.queue.push(this.commit());
	}
	public abortSync(): void {
		this.queue.push(this.abort());
	}
}
