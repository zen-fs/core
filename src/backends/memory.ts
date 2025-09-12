// SPDX-License-Identifier: LGPL-3.0-or-later
import type { UsageInfo } from '../internal/filesystem.js';
import { size_max } from '../constants.js';
import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { SyncMapTransaction, type SyncMapStore } from './store/map.js';

/**
 * A simple in-memory store
 * @category Stores and Transactions
 */
export class InMemoryStore extends Map<number, Uint8Array> implements SyncMapStore {
	public readonly flags = [] as const;

	public readonly name = 'tmpfs';

	public constructor(
		public readonly maxSize: number = size_max,
		public readonly label?: string
	) {
		super();
	}

	public async sync(): Promise<void> {}

	public transaction(): SyncMapTransaction {
		return new SyncMapTransaction(this);
	}

	public get bytes(): number {
		let size = this.size * 4;
		for (const data of this.values()) size += data.byteLength;
		return size;
	}

	public usage(): UsageInfo {
		return {
			totalSpace: this.maxSize,
			freeSpace: this.maxSize - this.bytes,
		};
	}
}

/**
 * Options for an in-memory backend
 * @category Backends and Configuration
 */
export interface InMemoryOptions {
	/** The maximum size of the store. Defaults to 4 GiB */
	maxSize?: number;

	/** The label to use for the store and file system */
	label?: string;
}

const _InMemory = {
	name: 'InMemory',
	options: {
		maxSize: { type: 'number', required: false },
		label: { type: 'string', required: false },
	},
	create({ maxSize, label }: InMemoryOptions) {
		const fs = new StoreFS(new InMemoryStore(maxSize, label));
		fs.checkRootSync();
		return fs;
	},
} as const satisfies Backend<StoreFS<InMemoryStore>, InMemoryOptions>;
type _InMemory = typeof _InMemory;
/**
 * A backend that uses an in-memory store for storing data
 * @category Backends and Configuration
 */
export interface InMemory extends _InMemory {}

/**
 * A simple in-memory file system backed by an InMemoryStore.
 * Files are not persisted across page loads.
 * @category Backends and Configuration
 */
export const InMemory: InMemory = _InMemory;
