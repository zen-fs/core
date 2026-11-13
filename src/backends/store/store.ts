// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { warn } from 'kerium/log';
import type { UUID } from 'node:crypto';
import { Resource } from 'utilium/cache';
import type { UsageInfo } from '../../internal/filesystem.js';
import '../../polyfills.js';
import type { StoreFS } from './fs.js';

/**
 * @category Stores and Transactions
 */
export type StoreFlag =
	/** The store supports reading ranges and writing at offsets */
	| 'partial'
	/**
	 * Transactions apply their changes together when committed and discard them when aborted.
	 * Committing may throw ESTALE if another transaction changed what was read, and the operation is then run again.
	 */
	| 'atomic';

/**
 * Represents a key-value store.
 * @category Stores and Transactions
 */
export interface Store {
	/**
	 * @see FileSystem#id
	 */
	readonly type?: number;

	/**
	 * What the file system using this store should be called.
	 * For example, tmpfs for an in memory store
	 */
	readonly name: string;

	/**
	 * A name for this instance of the store.
	 * For example, you might use a share name for a network-based store
	 */
	readonly label?: string;

	/**
	 * A UUID for this instance of the store.
	 */
	readonly uuid?: UUID;

	/**
	 * Syncs the store
	 */
	sync(): Promise<void>;

	/**
	 * Begins a new transaction.
	 */
	transaction(): Transaction;

	/**
	 * Use for optimizations
	 */
	readonly flags?: readonly StoreFlag[];

	/**
	 * Usage information for the store
	 */
	usage?(): UsageInfo;

	/**
	 * Allocate IDs for a new inode + data
	 */
	allocId?(): [ino: bigint, data: bigint];

	/**
	 * @internal @hidden
	 */
	fs?: StoreFS;
}

/**
 * A transaction for a store.
 * @category Stores and Transactions
 */
export abstract class Transaction<T extends Store = Store> {
	public constructor(public readonly store: T) {}

	/**
	 * Gets all of the keys
	 */
	public abstract keys(): Promise<Iterable<bigint>>;

	/**
	 * Retrieves data.
	 * @param id The key to look under for data.
	 */
	public abstract get(id: bigint, offset: number, end?: number): Promise<Uint8Array | undefined>;

	/**
	 * Retrieves data.
	 * @param id The key to look under for data.
	 * @throws `EAGAIN` If the data exists but can't be read synchronously, for example because it is not cached.
	 * @returns The data stored under the key. `undefined` only if the key does not exist.
	 */
	public abstract getSync(id: bigint, offset: number, end?: number): Uint8Array | undefined;

	/**
	 * Stores data under an id.
	 * Without `offset`, replaces any existing data.
	 * With `offset`, writes the data at `offset` and keeps the rest, which partial stores must support.
	 */
	public abstract set(id: bigint, data: Uint8Array, offset?: number): Promise<void>;

	/**
	 * Stores data under an id.
	 * Without `offset`, replaces any existing data.
	 * With `offset`, writes the data at `offset` and keeps the rest, which partial stores must support.
	 */
	public abstract setSync(id: bigint, data: Uint8Array, offset?: number): void;

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

	/** Applies the changes, which stores with the `atomic` flag must implement */
	public commit?(): Promise<void>;

	/** Applies the changes, which stores with the `atomic` flag must implement */
	public commitSync?(): void;

	/** Discards the changes, which stores with the `atomic` flag must implement */
	public abort?(): Promise<void>;

	/** Discards the changes, which stores with the `atomic` flag must implement */
	public abortSync?(): void;
}

/**
 * Transaction that implements asynchronous operations with synchronous ones
 * @category Stores and Transactions
 */
export abstract class SyncTransaction<T extends Store = Store> extends Transaction<T> {
	/* eslint-disable @typescript-eslint/require-await */

	public async get(id: bigint, offset: number, end?: number): Promise<Uint8Array | undefined> {
		return this.getSync(id, offset, end);
	}

	public async set(id: bigint, data: Uint8Array, offset?: number): Promise<void> {
		return this.setSync(id, data, offset);
	}

	public async remove(id: bigint): Promise<void> {
		return this.removeSync(id);
	}

	public async commit(): Promise<void> {
		return this.commitSync?.();
	}

	public async abort(): Promise<void> {
		return this.abortSync?.();
	}

	/* eslint-enable @typescript-eslint/require-await */
}

/**
 * @category Stores and Transactions
 */
export interface AsyncStore extends Store {
	cache?: Map<bigint, Resource<bigint>>;
}

/**
 * Transaction that implements synchronous operations with a cache
 * Implementors: You *must* update the cache and wait for `store.asyncDone` in your asynchronous methods.
 * @todo Make sure we handle abortions correctly, especially since the cache is shared between transactions.
 * @category Stores and Transactions
 */
export abstract class AsyncTransaction<T extends AsyncStore = AsyncStore> extends Transaction<T> {
	protected asyncDone: Promise<unknown> = Promise.resolve();

	/**
	 * Run a asynchronous operation from a sync context. Not magic and subject to (race) conditions.
	 * @internal
	 */
	protected async(promise: Promise<unknown>): void {
		this.asyncDone = this.asyncDone.then(() => promise);
	}

	/**
	 * Gets a cache resource
	 * If `info` is set and the resource doesn't exist, it will be created
	 * @internal
	 */
	_cached(id: bigint, info?: { size: number }) {
		this.store.cache ??= new Map();
		const resource = this.store.cache.get(id);
		if (!resource) return !info ? undefined : new Resource(id, info.size, {}, this.store.cache);
		if (info) resource.size = info.size;
		return resource;
	}

	public getSync(id: bigint, offset: number, end?: number): Uint8Array | undefined {
		const resource = this._cached(id);
		if (!resource) return;

		end ??= resource.size;
		const missing = resource.missing(offset, end);
		for (const { start, end } of missing) {
			this.async(this.get(id, start, end));
		}

		if (missing.length) throw withErrno('EAGAIN');

		const region = resource.regionAt(offset);

		if (!region) {
			warn('Missing cache region for ' + id);
			return;
		}

		return region.data.subarray(offset - region.offset, end - region.offset);
	}

	public setSync(id: bigint, data: Uint8Array, offset?: number): void {
		this.async(this.set(id, data, offset));
	}

	public removeSync(id: bigint): void {
		this.async(this.remove(id));

		this.store.cache?.delete(id);
	}
}

/**
 * Wraps a transaction with the ability to roll-back changes, among other things.
 * This is used by `StoreFS`
 * @category Stores and Transactions
 * @internal @hidden
 */
export class WrappedTransaction<T extends Store = Store> {
	/**
	 * Whether the transaction was committed or aborted
	 */
	protected done: boolean = false;

	public flag(flag: StoreFlag): boolean {
		return this.raw.store.flags?.includes(flag) ?? false;
	}

	/** Whether the store rolls back changes itself */
	protected readonly atomic: boolean;

	public constructor(
		public readonly raw: Transaction<T>,
		protected fs: StoreFS<T>,
	) {
		this.atomic = this.flag('atomic');
	}

	/**
	 * The data of each modified key before each modification, in order. Missing data means the key did not exist.
	 * Allows us to roll back commits.
	 */
	protected originalData: Map<bigint, { data?: Uint8Array; offset?: number }[]> = new Map();

	public keys(): Promise<Iterable<bigint>> {
		return this.raw.keys();
	}

	public get(id: bigint, offset: number = 0, end?: number): Promise<Uint8Array | undefined> {
		return this.raw.get(id, offset, end);
	}

	public getSync(id: bigint, offset: number = 0, end?: number): Uint8Array | undefined {
		return this.raw.getSync(id, offset, end);
	}

	public async set(id: bigint, view: Uint8Array | ArrayBufferView, offset?: number): Promise<void> {
		await this.markModified(id, offset, view.byteLength);
		const buffer = view instanceof Uint8Array ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
		await this.raw.set(id, buffer, offset);
	}

	public setSync(id: bigint, view: Uint8Array | ArrayBufferView, offset?: number): void {
		this.markModifiedSync(id, offset, view.byteLength);
		const buffer = view instanceof Uint8Array ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
		this.raw.setSync(id, buffer, offset);
	}

	public async remove(id: bigint): Promise<void> {
		await this.markModified(id);
		await this.raw.remove(id);
	}

	public removeSync(id: bigint): void {
		this.markModifiedSync(id);
		this.raw.removeSync(id);
	}

	public async commit(): Promise<void> {
		if (this.atomic) await this.raw.commit!();
		this.done = true;
	}

	public commitSync(): void {
		if (this.atomic) this.raw.commitSync!();
		this.done = true;
	}

	public async abort(): Promise<void> {
		if (this.done) return;
		if (this.atomic) await this.raw.abort!();
		for (const [id, entries] of this.originalData) {
			for (const { data, offset } of entries.toReversed()) {
				if (data) await this.raw.set(id, data, offset);
				else await this.raw.remove(id);
			}
			if (!entries[0].data) this.fs._remove(id);
		}
		this.done = true;
	}

	public abortSync(): void {
		if (this.done) return;
		if (this.atomic) this.raw.abortSync!();
		for (const [id, entries] of this.originalData) {
			for (const { data, offset } of entries.toReversed()) {
				if (data) this.raw.setSync(id, data, offset);
				else this.raw.removeSync(id);
			}
			if (!entries[0].data) this.fs._remove(id);
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

	/** Records the data of a key before it is modified, or that it did not exist */
	protected stash(id: bigint, data?: Uint8Array, offset?: number): void {
		if (this.atomic) return;
		this.originalData.getOrInsertComputed(id, () => []).push({ data, offset });
	}

	/**
	 * Marks an id as modified, and stashes its value if it has not been stashed already.
	 */
	protected async markModified(id: bigint, offset?: number, length?: number): Promise<void> {
		if (this.atomic) return;
		const end = offset !== undefined && length ? offset + length : undefined;
		try {
			this.stash(id, await this.raw.get(id, offset ?? 0, end), offset);
		} catch (e) {
			if (!(this.raw instanceof AsyncTransaction)) throw e;

			/*
				async transaction has a quirk:
				setting the buffer to a larger size doesn't work correctly due to cache ranges
				so, we cache the existing sub-ranges
			*/

			const tx = this.raw as AsyncTransaction<AsyncStore>;
			const resource = tx._cached(id);
			if (!resource) throw e;

			for (const range of resource.cached(offset ?? 0, end ?? offset ?? 0)) {
				this.stash(id, await this.raw.get(id, range.start, range.end), range.start);
			}
		}
	}

	/**
	 * Marks an id as modified, and stashes its value if it has not been stashed already.
	 */
	protected markModifiedSync(id: bigint, offset?: number, length?: number): void {
		if (this.atomic) return;
		const end = offset !== undefined && length ? offset + length : undefined;

		try {
			this.stash(id, this.raw.getSync(id, offset ?? 0, end), offset);
		} catch (e) {
			if (!(this.raw instanceof AsyncTransaction)) throw e;

			/*
				async transaction has a quirk:
				setting the buffer to a larger size doesn't work correctly due to cache ranges
				so, we cache the existing sub-ranges
			*/

			const tx = this.raw as AsyncTransaction<AsyncStore>;
			const resource = tx._cached(id);
			if (!resource) throw e;

			for (const range of resource.cached(offset ?? 0, end ?? offset ?? 0)) {
				this.stash(id, this.raw.getSync(id, range.start, range.end), range.start);
			}
		}
	}
}
