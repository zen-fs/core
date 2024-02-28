import { SyncStore, SimpleSyncStore, SimpleSyncRWTransaction, SyncRWTransaction, SyncStoreFileSystem } from './SyncStore.js';
import { CreateBackend, type BackendOptions } from './backend.js';

/**
 * A simple in-memory key-value store backed by a JavaScript object.
 */
export class InMemoryStore implements SyncStore, SimpleSyncStore {
	private store: Map<string, Uint8Array> = new Map<string, Uint8Array>();

	public name = InMemoryFileSystem.Name;

	public clear() {
		this.store.clear();
	}

	public beginTransaction(type: string): SyncRWTransaction {
		return new SimpleSyncRWTransaction(this);
	}

	public get(key: string): Uint8Array {
		return this.store.get(key);
	}

	public put(key: string, data: Uint8Array, overwrite: boolean): boolean {
		if (!overwrite && this.store.has(key)) {
			return false;
		}
		this.store.set(key, data);
		return true;
	}

	public remove(key: string): void {
		this.store.delete(key);
	}
}

/**
 * A simple in-memory file system backed by an InMemoryStore.
 * Files are not persisted across page loads.
 */
export class InMemoryFileSystem extends SyncStoreFileSystem {
	public static readonly Name = 'InMemory';

	public static Create = CreateBackend.bind(this);

	public static readonly Options: BackendOptions = {};

	public constructor() {
		super({ store: new InMemoryStore() });
	}
}
