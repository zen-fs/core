import type { Ino } from '../inode.js';
import { SyncStore, SimpleSyncStore, SimpleSyncRWTransaction, SyncRWTransaction, SyncStoreFileSystem } from './SyncStore.js';
import { createBackend, type Backend } from './backend.js';

/**
 * A simple in-memory store
 */
export class InMemoryStore implements SyncStore, SimpleSyncStore {
	private store: Map<Ino, Uint8Array> = new Map();

	constructor(public name: string = 'tmp') {}
	public clear() {
		this.store.clear();
	}

	public beginTransaction(): SyncRWTransaction {
		return new SimpleSyncRWTransaction(this);
	}

	public get(key: Ino) {
		return this.store.get(key);
	}

	public put(key: Ino, data: Uint8Array, overwrite: boolean): boolean {
		if (!overwrite && this.store.has(key)) {
			return false;
		}
		this.store.set(key, data);
		return true;
	}

	public remove(key: Ino): void {
		this.store.delete(key);
	}
}

export const InMemory: Backend = {
	name: 'InMemory',
	isAvailable(): boolean {
		return true;
	},
	options: {
		name: {
			type: 'string',
			description: 'The name of the store',
		},
	},
	create({ name }: { name: string }) {
		return new SyncStoreFileSystem({ store: new InMemoryStore(name) });
	},
};

/**
 * A simple in-memory file system backed by an InMemoryStore.
 * Files are not persisted across page loads.
 */
export class _InMemory extends SyncStoreFileSystem {
	public static isAvailable(): boolean {
		return true;
	}

	public static create = createBackend.bind(this);

	public static readonly options = {};

	public constructor() {
		super({ store: new InMemoryStore() });
	}
}
