import type { Ino } from '../inode.js';
import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { SimpleSyncStore } from './store/simple.js';

/**
 * A simple in-memory store
 */
export class InMemoryStore extends SimpleSyncStore {
	protected data: Map<Ino, Uint8Array> = new Map();

	public constructor(public name: string = 'tmp') {
		super();
	}

	public get(ino: Ino): Uint8Array | undefined {
		return this.data.get(ino);
	}

	public delete(ino: Ino): void {
		this.data.delete(ino);
	}

	public clearSync(): void {
		this.data.clear();
	}

	public set(ino: Ino, data: Uint8Array): void {
		this.data.set(ino, data);
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
