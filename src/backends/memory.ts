// SPDX-License-Identifier: LGPL-3.0-or-later
import type { UsageInfo } from '../internal/filesystem.js';
import { size_max } from '../constants.js';
import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { SyncMapTransaction, type SyncMapStore } from './store/map.js';
import type { StoreFlag } from './store/store.js';

/**
 * A simple in-memory store.
 * Data is kept and read as views, and grows with spare capacity so appending is cheap.
 * @category Stores and Transactions
 */
export class InMemoryStore extends Map<bigint, Uint8Array> implements SyncMapStore {
	public readonly flags: readonly StoreFlag[] = ['partial'];

	public readonly name: string = 'tmpfs';

	/** Buffers allocated by the store, whose spare capacity it can grow into */
	#owned = new WeakSet<ArrayBufferLike>();

	public constructor(
		public readonly maxSize: number = size_max,
		public readonly label?: string,
	) {
		super();
	}

	public get(id: bigint, offset: number = 0, end?: number): Uint8Array | undefined {
		return super.get(id)?.subarray(offset, end);
	}

	public set(id: bigint, data: Uint8Array, offset?: number): this {
		if (offset === undefined) return super.set(id, data);

		const existing = super.get(id) ?? new Uint8Array();
		const end = offset + data.byteLength;

		if (end <= existing.byteLength) {
			existing.set(data, offset);
			return this;
		}

		let grown: Uint8Array;
		if (this.#owned.has(existing.buffer) && end <= existing.buffer.byteLength - existing.byteOffset) {
			grown = new Uint8Array(existing.buffer, existing.byteOffset, end);
			grown.fill(0, existing.byteLength, offset);
		} else {
			grown = new Uint8Array(new ArrayBuffer(Math.max(end, existing.byteLength * 2)), 0, end);
			this.#owned.add(grown.buffer);
			grown.set(existing);
		}
		grown.set(data, offset);
		return super.set(id, grown);
	}

	public async sync(): Promise<void> {}

	public transaction(): SyncMapTransaction {
		return new SyncMapTransaction(this);
	}

	public get bytes(): number {
		let size = this.size * 8;
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
