import { ErrnoError } from '../../error.js';
import '../../polyfills.js';

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
	public abstract keys(): Promise<Iterable<bigint>>;

	/**
	 * Gets all of the keys
	 */
	public abstract keysSync(): Iterable<bigint>;

	/**
	 * Retrieves data.
	 * @param id The key to look under for data.
	 */
	public abstract get(id: bigint): Promise<Uint8Array>;

	/**
	 * Retrieves data.
	 * Throws an error if an error occurs or if the key does not exist.
	 * @param id The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	public abstract getSync(id: bigint): Uint8Array;

	/**
	 * Adds the data to the store under an id. Overwrites any existing data.
	 * @param id The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract set(id: bigint, data: Uint8Array): Promise<void>;

	/**
	 * Adds the data to the store under and id.
	 * @param id The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract setSync(id: bigint, data: Uint8Array): void;

	/**
	 * Deletes the data at `ino`.
	 * @param id The key to delete from the store.
	 */
	public abstract remove(id: bigint): Promise<void>;

	/**
	 * Deletes the data at `ino`.
	 * @param id The key to delete from the store.
	 */
	public abstract removeSync(id: bigint): void;

	/**
	 * Commits the transaction.
	 */
	public abstract commit(): Promise<void>;

	public async [Symbol.asyncDispose]() {
		if (this.done) {
			return;
		}

		await this.abort();
	}

	/**
	 * Commits the transaction.
	 */
	public abstract commitSync(): void;

	public [Symbol.dispose]() {
		if (this.done) {
			return;
		}

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
	public async keys(): Promise<Iterable<bigint>> {
		return this.keysSync();
	}
	public async get(id: bigint): Promise<Uint8Array> {
		return this.getSync(id);
	}

	public async set(id: bigint, data: Uint8Array): Promise<void> {
		return this.setSync(id, data);
	}

	public async remove(id: bigint): Promise<void> {
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
 * Transaction that only supports asynchronous operations
 */
export abstract class AsyncTransaction<T extends Store = Store> extends Transaction<T> {
	public keysSync(): never {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.keysSync');
	}

	public getSync(): never {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.getSync');
	}

	public setSync(): never {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.setSync');
	}

	public removeSync(): never {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.removeSync');
	}

	public commitSync(): never {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.commitSync');
	}

	public abortSync(): never {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.abortSync');
	}
}
