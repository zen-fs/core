import { ErrnoError } from '../../error.js';
import type { Ino } from '../../inode.js';

/**
 * Represents a key-value store.
 */
export interface Store {
	/**
	 * The name of the key-value store.
	 */
	name: string;

	/**
	 *
	 */
	sync(): Promise<void>;

	/**
	 * Empties the store completely.
	 */
	clear(): Promise<void>;

	/**
	 * Empties the store completely.
	 */
	clearSync(): void;

	/**
	 * Begins a new transaction.
	 */
	beginTransaction(): Transaction;
}

/**
 * A transaction for a synchronous key value store.
 */
export interface Transaction {
	/**
	 * Retrieves the data at the given key.
	 * @param ino The key to look under for data.
	 */
	get(ino: Ino): Promise<Uint8Array>;

	/**
	 * Retrieves the data at the given key. Throws an error if an error occurs
	 * or if the key does not exist.
	 * @param ino The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	getSync(ino: Ino): Uint8Array | void;

	/**
	 * Adds the data to the store under the given key. Overwrites any existing
	 * data.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids writing the data if the key exists.
	 */
	put(ino: Ino, data: Uint8Array, overwrite: boolean): Promise<boolean>;

	/**
	 * Adds the data to the store under the given key.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids storing the data if the key exists.
	 * @return True if storage succeeded, false otherwise.
	 */
	putSync(ino: Ino, data: Uint8Array, overwrite: boolean): boolean;

	/**
	 * Deletes the data at the given key.
	 * @param ino The key to delete from the store.
	 */
	remove(ino: Ino): Promise<void>;

	/**
	 * Deletes the data at the given key.
	 * @param ino The key to delete from the store.
	 */
	removeSync(ino: Ino): void;

	/**
	 * Commits the transaction.
	 */
	commit(): Promise<void>;

	/**
	 * Commits the transaction.
	 */
	commitSync(): void;

	/**
	 * Aborts and rolls back the transaction.
	 */
	abort(): Promise<void>;

	/**
	 * Aborts and rolls back the transaction.
	 */
	abortSync(): void;
}

/**
 * Transaction that implement asynchronous operations with synchronous ones
 */
export abstract class SyncTransaction implements Transaction {
	public abstract getSync(ino: Ino): Uint8Array;
	public async get(ino: Ino): Promise<Uint8Array> {
		return this.getSync(ino);
	}
	public abstract putSync(ino: bigint, data: Uint8Array, overwrite: boolean): boolean;
	public async put(ino: bigint, data: Uint8Array, overwrite: boolean): Promise<boolean> {
		return this.putSync(ino, data, overwrite);
	}
	public abstract removeSync(ino: bigint): void;
	public async remove(ino: Ino): Promise<void> {
		return this.removeSync(ino);
	}
	public abstract commitSync(): void;
	public async commit(): Promise<void> {
		return this.commitSync();
	}
	public abstract abortSync(): void;
	public async abort(): Promise<void> {
		return this.abortSync();
	}
}

/**
 * Transaction that only supports asynchronous operations
 * @todo Add caching
 */
export abstract class AsyncTransaction implements Transaction {
	public getSync(ino: Ino): Uint8Array | void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.getSync');
	}
	public abstract get(key: bigint): Promise<Uint8Array>;
	public putSync(ino: bigint, data: Uint8Array, overwrite: boolean): boolean {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.putSync');
	}
	public abstract put(key: bigint, data: Uint8Array, overwrite: boolean): Promise<boolean>;
	public removeSync(ino: bigint): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.removeSync');
	}
	public abstract remove(key: bigint): Promise<void>;
	public commitSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.commitSync');
	}
	public abstract commit(): Promise<void>;
	public abortSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.abortSync');
	}
	public abstract abort(): Promise<void>;
}
