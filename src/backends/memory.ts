import type { Ino } from '../inode.js';
import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { SimpleTransaction, type SimpleSyncStore } from './store/simple.js';

/**
 * A simple in-memory store
 */
export class InMemoryStore extends Map<Ino, Uint8Array> implements SimpleSyncStore {
	public constructor(public name: string = 'tmp') {
		super();
	}

	public async sync(): Promise<void> {}

	public clearSync(): void {
		this.clear();
	}

	public transaction(): SimpleTransaction {
		return new SimpleTransaction(this);
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
		return new StoreFS(new InMemoryStore(name));
	},
} as const satisfies Backend<StoreFS<InMemoryStore>, { name?: string }>;
