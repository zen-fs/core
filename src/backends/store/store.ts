import { ErrnoError } from '../../error.ts';
import type { Ino } from '../../inode.ts';
import '../../polyfills.ts';

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
	 * Whether the transaction was commited or aborted
	 */
	protected done: boolean = false;

	/**
	 * Retrieves the data at `ino`.
	 * @param ino The key to look under for data.
	 */
	public abstract get(ino: Ino): Promise<Uint8Array>;

	/**
	 * Retrieves the data at `ino`.
	 * Throws an error if an error occurs or if the key does not exist.
	 * @param ino The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	public abstract getSync(ino: Ino): Uint8Array;

	/**
	 * Adds the data to the store under `ino`. Overwrites any existing data.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract set(ino: Ino, data: Uint8Array): Promise<void>;

	/**
	 * Adds the data to the store under `ino`.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 */
	public abstract setSync(ino: Ino, data: Uint8Array): void;

	/**
	 * Deletes the data at `ino`.
	 * @param ino The key to delete from the store.
	 */
	public abstract remove(ino: Ino): Promise<void>;

	/**
	 * Deletes the data at `ino`.
	 * @param ino The key to delete from the store.
	 */
	public abstract removeSync(ino: Ino): void;

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
	/* eslint-enable @typescript-eslint/require-await */
}

/**
 * Transaction that only supports asynchronous operations
 */
export abstract class AsyncTransaction<T extends Store = Store> extends Transaction<T> {
	public getSync(): Uint8Array {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.getSync');
	}

	public setSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.setSync');
	}

	public removeSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.removeSync');
	}

	public commitSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.commitSync');
	}

	public abortSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.abortSync');
	}
}
