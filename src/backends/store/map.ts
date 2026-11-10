// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Store } from './store.js';
import { AsyncTransaction, SyncTransaction } from './store.js';

/**
 * An interface for simple synchronous stores that don't have special support for transactions and such, based on `Map`
 * @category Stores and Transactions
 */
export interface SyncMapStore extends Store {
	keys(): Iterable<bigint>;
	get(id: bigint, offset?: number, end?: number): Uint8Array | undefined;
	getAsync?(id: bigint, offset?: number, end?: number): Promise<Uint8Array | undefined>;
	set(id: bigint, data: Uint8Array, offset?: number): void;
	delete(id: bigint): void;
}

/**
 * Transaction for map stores.
 * @category Stores and Transactions
 * @see SyncMapStore
 */
export class SyncMapTransaction extends SyncTransaction<SyncMapStore> {
	declare public readonly store: SyncMapStore;

	// eslint-disable-next-line @typescript-eslint/require-await
	public async keys(): Promise<Iterable<bigint>> {
		return this.store.keys();
	}

	public async get(id: bigint, offset?: number, end?: number): Promise<Uint8Array | undefined> {
		return await (this.store.getAsync?.(id, offset, end) ?? this.store.get(id, offset, end));
	}

	public getSync(id: bigint, offset?: number, end?: number): Uint8Array | undefined {
		return this.store.get(id, offset, end);
	}

	public setSync(id: bigint, data: Uint8Array, offset?: number): void {
		this.store.set(id, data, offset);
	}

	public removeSync(id: bigint): void {
		this.store.delete(id);
	}
}

/**
 * An interface for simple asynchronous stores that don't have special support for transactions and such, based on `Map`.
 * @category Stores and Transactions
 */
export interface AsyncMap {
	keys(): Iterable<bigint>;
	get(id: bigint, offset?: number, end?: number): Promise<Uint8Array | undefined>;
	cached(id: bigint, offset?: number, end?: number): Uint8Array | undefined;
	set(id: bigint, data: Uint8Array, offset?: number): Promise<void>;
	delete(id: bigint): Promise<void>;
}

/**
 * @category Stores and Transactions
 */
export class AsyncMapTransaction<T extends Store & AsyncMap = Store & AsyncMap> extends AsyncTransaction<T> {
	public async keys(): Promise<Iterable<bigint>> {
		await this.asyncDone;
		return this.store.keys();
	}

	public async get(id: bigint, offset?: number, end?: number): Promise<Uint8Array | undefined> {
		await this.asyncDone;
		return await this.store.get(id, offset, end);
	}

	public getSync(id: bigint, offset?: number, end?: number): Uint8Array | undefined {
		return this.store.cached(id, offset, end);
	}

	public async set(id: bigint, data: Uint8Array, offset = 0): Promise<void> {
		await this.asyncDone;
		await this.store.set(id, data, offset);
	}

	public async remove(id: bigint): Promise<void> {
		await this.asyncDone;
		await this.store.delete(id);
	}
}
