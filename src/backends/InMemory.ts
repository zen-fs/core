import type { Ino } from '../inode.js';
import type { Backend } from './backend.js';
import { SimpleSyncStore, StoreFS } from './Store.js';

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

	public put(ino: Ino, data: Uint8Array, overwrite: boolean): boolean {
		if (!overwrite && this.data.has(ino)) {
			return false;
		}
		this.data.set(ino, data);
		return true;
	}

	public entries(): Iterable<[Ino, Uint8Array]> {
		return [...this.data.entries()];
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
