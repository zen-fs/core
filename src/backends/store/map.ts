import { SyncTransaction, type Store } from './store.js';

/**
 * An interface for simple synchronous stores that don't have special support for transactions and such, based on `Map`
 */
export interface MapStore extends Store {
	keys(): Iterable<number>;
	get(id: number): Uint8Array | undefined;
	getAsync?(id: number): Promise<Uint8Array | undefined>;
	set(id: number, data: Uint8Array, isMetadata?: boolean): void;
	delete(id: number): void;
}

/**
 * An interface for simple asynchronous stores that don't have special support for transactions and such, based on `Map`.
 * This class adds caching at the store level.
 */
export abstract class AsyncMapStore implements MapStore {
	public abstract name: string;

	protected cache: Map<number, Uint8Array> = new Map();

	protected asyncDone: Promise<unknown> = Promise.resolve();

	/** @internal @hidden */
	protected queue(promise: Promise<unknown>): void {
		this.asyncDone = this.asyncDone.then(() => promise);
	}

	protected abstract entries(): Promise<Iterable<[number, Uint8Array]>>;

	public keys(): Iterable<number> {
		return this.cache.keys();
	}

	abstract getAsync(id: number): Promise<Uint8Array | undefined>;

	public get(id: number): Uint8Array | undefined {
		return this.cache.get(id);
	}

	public set(id: number, data: Uint8Array): void {
		this.cache.set(id, data);
		this.queue(this.setAsync(id, data));
	}

	protected abstract setAsync(ino: number, data: Uint8Array): Promise<void>;

	public delete(id: number): void {
		this.cache.delete(id);
		this.queue(this.deleteAsync(id));
	}

	protected abstract deleteAsync(ino: number): Promise<void>;

	public clearSync(): void {
		this.cache.clear();
		this.queue(this.clear());
	}

	public abstract clear(): Promise<void>;

	public async sync(): Promise<void> {
		for (const [ino, data] of await this.entries()) {
			if (!this.cache.has(ino)) {
				this.cache.set(ino, data);
			}
		}
		await this.asyncDone;
	}

	public transaction(): MapTransaction {
		return new MapTransaction(this);
	}
}

/**
 * Transaction for map stores.
 * @see MapStore
 * @see AsyncMapStore
 */
export class MapTransaction extends SyncTransaction<MapStore> {
	protected declare store: MapStore;

	public keysSync(): Iterable<number> {
		return this.store.keys();
	}

	public async get(id: number): Promise<Uint8Array | undefined> {
		return await (this.store.getAsync?.(id) ?? this.store.get(id));
	}

	public getSync(id: number): Uint8Array | undefined {
		return this.store.get(id);
	}

	public setSync(id: number, data: Uint8Array): void {
		return this.store.set(id, data);
	}

	public removeSync(id: number): void {
		this.store.delete(id);
	}

	public commitSync(): void {}

	public abortSync(): void {}
}
