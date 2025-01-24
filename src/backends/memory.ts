import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { MapTransaction, type MapStore } from './store/map.js';

/**
 * A simple in-memory store
 */
export class InMemoryStore extends Map<number, Uint8Array> implements MapStore {
	public constructor(public name: string = 'tmp') {
		super();
	}

	public async sync(): Promise<void> {}

	public clearSync(): void {
		this.clear();
	}

	public transaction(): MapTransaction {
		return new MapTransaction(this);
	}
}

const _InMemory = {
	name: 'InMemory',
	options: {
		name: { type: 'string', required: false },
	},
	create({ name }: { name?: string }) {
		const fs = new StoreFS(new InMemoryStore(name));
		fs.checkRootSync();
		return fs;
	},
} as const satisfies Backend<StoreFS<InMemoryStore>, { name?: string }>;
type _InMemory = typeof _InMemory;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InMemory extends _InMemory {}

/**
 * A simple in-memory file system backed by an InMemoryStore.
 * Files are not persisted across page loads.
 */
export const InMemory: InMemory = _InMemory;
