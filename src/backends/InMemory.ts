import type { Ino } from '../inode.js';
import type { Backend } from './backend.js';
import { SimpleSyncStore, SimpleSyncTransaction, StoreFS, type Store } from './Store.js';

/**
 * A simple in-memory store
 */
export class InMemoryStore implements Store, SimpleSyncStore {
	private store: Map<Ino, Uint8Array> = new Map();

	public constructor(public name: string = 'tmp') {}
	public clear() {
		this.store.clear();
	}

	public clearSync(): void {
		this.store.clear();
	}

	public beginTransaction(): SimpleSyncTransaction {
		return new SimpleSyncTransaction(this);
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

/**
 * A simple in-memory file system backed by an InMemoryStore.
 * Files are not persisted across page loads.
 */
export const InMemory = {
	name: 'InMemory',
	isAvailable(): boolean {
		return true;
	},
	options: {
		name: {
			type: 'string',
			required: false,
			description: 'The name of the store',
		},
	},
	create({ name }: { name?: string }) {
		return new StoreFS({ store: new InMemoryStore(name) });
	},
} as const satisfies Backend<StoreFS, { name?: string }>;
