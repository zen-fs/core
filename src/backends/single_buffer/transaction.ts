// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { alert, crit, err } from 'kerium/log';
import { offsetof, sizeof } from 'memium';
import { BPlusTree, type BPlusTreeStorage } from 'memium/bplustree';
import { types as primitive } from 'memium/primitives';
import { Void } from 'memium/types';
import { Inode } from '../../internal/inode.js';
import type { SingleBufferStore } from './store.js';
import { DataExtent, SpareHeader, PendingHeader, Extent, type Commit } from './data.js';

/**
 * Thrown when the free trees need more blocks than there are spares
 * @internal @hidden
 */
export const sparesExhausted = withErrno('ENOSPC', 'sbfs: no spare blocks');

const hex = (value: number | bigint): string => '0x' + value.toString(16).padStart(8, '0');

/** Key for the free tree ordered by size */
const sizeKey = (size: number, offset: number): bigint => (BigInt(size) << 32n) | BigInt(offset);

/**
 * A transaction that changes a file system, which is built from copies of the blocks it changes.
 * Nothing it does is visible until it is committed.
 */
export class WriteTransaction implements BPlusTreeStorage {
	public readonly buffer: ArrayBufferLike;
	public readonly pageSize: number;
	public readonly generation: bigint;

	/** ID to extent */
	public readonly index: BPlusTree<bigint, DataExtent>;

	/** Free extents by offset */
	protected readonly byOffset: BPlusTree<number, number>;

	/** Free extents by size then offset */
	protected readonly bySize: BPlusTree<bigint, void>;

	protected freeBytes: number;
	protected spareHead: number;
	protected spareCount: number;
	protected spareTotal: number;

	/** Spare blocks listed by the base commit in the newest list block, which can not be overwritten */
	protected spareFloor: number;

	protected readonly spareCapacity: number;
	protected pendingHead: number;
	protected pendingTail: number;
	protected pendingBytes: number;

	/** Blocks allocated by this transaction */
	protected readonly fresh = new Set<number>();

	/** Blocks no commit references, which can be reused immediately */
	protected recycled: number[] = [];

	/** Extents that become free once no reader can see them */
	protected retired: [offset: number, size: number][] = [];

	/** Whether the free trees are being changed, during which spares are not refilled */
	protected changingFreeTrees = false;

	/**
	 * @param base The commit this transaction starts from
	 * @param spareScale Multiplies the number of spare blocks to keep
	 */
	public constructor(
		protected readonly store: SingleBufferStore,
		base: Commit,
		protected readonly spareScale: number,
	) {
		this.buffer = store.buffer;
		this.pageSize = store.blockSize;
		this.generation = base.generation + 1n;

		this.freeBytes = base.free_bytes;
		this.spareHead = base.spare_head;
		this.spareCount = this.spareFloor = base.spare_count;
		this.spareTotal = base.spare_total;
		this.spareCapacity = (this.pageSize - sizeof(SpareHeader)) / 4;
		this.pendingHead = base.pending_head;
		this.pendingTail = base.pending_tail;
		this.pendingBytes = base.pending_bytes;

		this.index = new BPlusTree<bigint, DataExtent>(this, { key: primitive.uint64, value: DataExtent }, base.index_root, base.index_count);
		this.byOffset = new BPlusTree(this, { key: primitive.uint32, value: primitive.uint32 }, base.free_root, base.free_count);
		this.bySize = new BPlusTree(this, { key: primitive.uint64, value: Void }, base.size_root, base.free_count);

		this.releasePending(store.epochs.oldest());
	}

	public offsetOf(block: number): number {
		return this.store.byteOffset + block;
	}

	public alloc(): number {
		let block = this.recycled.pop();

		if (block === undefined) {
			this.refillSpares();
			block = this.popSpare();
		}

		if (block === undefined) {
			if (this.changingFreeTrees) throw sparesExhausted;
			throw err(withErrno('ENOSPC', 'sbfs: no space for metadata'));
		}

		this.fresh.add(block);
		return block;
	}

	public free(block: number): void {
		if (this.fresh.delete(block)) this.recycled.push(block);
		else this.retired.push([block, this.pageSize]);
	}

	// Spare blocks

	/** Minimum blocks available for tree nodes, enough to copy and split a path in both free trees */
	protected lowWater(): number {
		return 4 * (Math.max(this.byOffset.height, this.bySize.height) + 1) * this.spareScale;
	}

	/** Blocks that can be allocated without changing the free trees */
	protected availableBlocks(): number {
		return this.spareTotal + this.recycled.length;
	}

	/** Takes a spare block, if there are any */
	protected popSpare(): number | undefined {
		while (this.spareHead && !this.spareCount) {
			const next = this.store.getUint32(this.spareHead + offsetof(SpareHeader, 'next'), true);
			this.free(this.spareHead);
			this.spareHead = next;
			this.spareCount = this.spareFloor = next && this.store.getUint32(next + offsetof(SpareHeader, 'count'), true);
		}

		if (!this.spareCount) return;

		this.spareCount--;
		this.spareTotal--;
		return this.store.getUint32(this.spareHead + sizeof(SpareHeader) + this.spareCount * 4, true);
	}

	/** Adds a free block to the spare blocks */
	protected pushSpare(block: number): void {
		if (this.spareHead && this.spareCount >= this.spareFloor && this.spareCount < this.spareCapacity) {
			this.store.setUint32(this.spareHead + sizeof(SpareHeader) + this.spareCount * 4, block, true);
			this.spareCount++;
			this.spareTotal++;
			return;
		}

		// The block becomes the newest list block
		if (this.spareHead) this.store.setUint32(this.spareHead + offsetof(SpareHeader, 'count'), this.spareCount, true);
		this.store.setUint32(block + offsetof(SpareHeader, 'next'), this.spareHead, true);
		this.spareHead = block;
		this.spareCount = this.spareFloor = 0;
		this.fresh.add(block);
	}

	/** Refills the spare blocks if they are below the low-water mark */
	protected refillSpares(): void {
		if (this.changingFreeTrees) return;
		const low = this.lowWater();
		if (this.availableBlocks() >= low) return;

		this.changeFreeTrees(() => {
			const total = Math.floor(this.store.byteLength / this.pageSize);
			for (let blocks = Math.min(low * 2, total); blocks >= 1 && this.availableBlocks() < low;) {
				try {
					const offset = this.takeBestFit(blocks * this.pageSize);
					for (let i = 0; i < blocks; i++) this.pushSpare(offset + i * this.pageSize);
				} catch (e) {
					if (e === sparesExhausted || (e as { code?: string }).code != 'ENOSPC') throw e;
					blocks >>= 1;
				}
			}
		});
	}

	// Free space

	protected changeFreeTrees<T>(change: () => T): T {
		this.changingFreeTrees = true;
		try {
			return change();
		} finally {
			this.changingFreeTrees = false;
		}
	}

	/** Removes the free extent at `offset`, then returns everything after its first `size` bytes to free space */
	protected split(offset: number, length: number, size: number): void {
		this.bySize.delete(sizeKey(length, offset));
		this.byOffset.delete(offset);

		if (length > size) {
			this.byOffset.set(offset + size, length - size);
			this.bySize.set(sizeKey(length - size, offset + size), undefined);
		}

		this.freeBytes -= size;
	}

	/** Takes the smallest free extent that fits `size` bytes */
	protected takeBestFit(size: number): number {
		const found = this.bySize.ceiling(sizeKey(size, 0));
		if (!found) throw withErrno('ENOSPC', 'sbfs: no free extent is large enough');

		const offset = Number(found[0] & 0xffffffffn);
		this.split(offset, Number(found[0] >> 32n), size);
		return offset;
	}

	/** Allocates `size` bytes for data, leaving enough blocks to change the free trees */
	public allocate(size: number): number {
		this.refillSpares();
		if (this.availableBlocks() < this.lowWater()) throw withErrno('ENOSPC', 'sbfs: no space left');
		return this.changeFreeTrees(() => this.takeBestFit(size));
	}

	/** Frees an extent no reader can see, merging it with adjacent free extents */
	public freeExtent(offset: number, size: number): void {
		if (!size) return;

		this.refillSpares();
		this.changeFreeTrees(() => {
			let start = offset,
				length = size;

			const prev = this.byOffset.floor(offset);
			if (prev && prev[0] + prev[1] > offset) throw crit(withErrno('EIO', `sbfs: extent at ${hex(offset)} was freed twice`));

			if (prev && prev[0] + prev[1] == offset) {
				start = prev[0];
				length += prev[1];
				this.bySize.delete(sizeKey(prev[1], prev[0]));
			}

			const next = this.byOffset.ceiling(offset);
			if (next && next[0] < offset + size) throw crit(withErrno('EIO', `sbfs: extent at ${hex(offset)} was freed twice`));

			if (next && next[0] == offset + size) {
				length += next[1];
				this.byOffset.delete(next[0]);
				this.bySize.delete(sizeKey(next[1], next[0]));
			}

			this.byOffset.set(start, length);
			this.bySize.set(sizeKey(length, start), undefined);
			this.freeBytes += size;
		});
	}

	/** Frees an extent once no reader can see this transaction's base */
	public retire(offset: number, size: number): void {
		if (size) this.retired.push([offset, size]);
	}

	// Data

	/** Replaces the data for `id`, or writes it at `offset` and keeps the rest */
	public set(id: bigint, data: Uint8Array, offset?: number): void {
		if (id === 0n && offset === undefined && data.length < sizeof(Inode))
			throw alert(withErrno('EIO', `sbfs: tried to set ${data.length} bytes for id 0!`));

		const { bytes } = this.store;
		const old = this.index.get(id);
		const kept = offset === undefined ? 0 : (old?.size ?? 0);
		const start = offset ?? 0;
		const extent = Object.assign(new DataExtent(), { size: Math.max(kept, start + data.length) });

		// Bytes past the old size are not visible to readers of older versions
		if (old && offset !== undefined && start >= old.size && extent.size <= old.capacity) {
			extent.offset = old.offset;
			extent.capacity = old.capacity;
		} else {
			// Partial writes keep the old capacity, and data that outgrows it gets room to keep growing
			const capacity = offset === undefined ? 0 : (old?.capacity ?? 0);
			if (extent.size <= capacity) extent.capacity = capacity;
			else if (capacity) extent.capacity = Math.max(extent.size, Math.floor(capacity * 1.5));
			else extent.capacity = extent.size;
			try {
				extent.offset = extent.capacity ? this.allocate(extent.capacity) : 0;
			} catch (e) {
				if (e === sparesExhausted || (e as { code?: string }).code != 'ENOSPC' || extent.capacity == extent.size) throw e;
				extent.capacity = extent.size;
				extent.offset = this.allocate(extent.size);
			}

			if (old) {
				bytes.copyWithin(extent.offset, old.offset, old.offset + kept);
				this.retire(old.offset, old.capacity);
			}
		}

		bytes.fill(0, extent.offset + kept, extent.offset + start);
		bytes.set(data, extent.offset + start);
		this.index.set(id, extent);
	}

	public delete(id: bigint): void {
		const old = this.index.get(id);
		if (!old) return;
		this.index.delete(id);
		this.retire(old.offset, old.capacity);
	}

	// Pending extents

	/** Frees extents retired by generations that readers no longer see */
	protected releasePending(oldest: bigint | undefined): void {
		while (this.pendingHead) {
			const block = this.pendingHead;
			if (oldest !== undefined && this.store.getBigUint64(block + offsetof(PendingHeader, 'generation'), true) > oldest) break;

			// Released blocks become spares, up to twice the low-water mark
			for (let i = 0; i < this.store.getUint32(block + offsetof(PendingHeader, 'count'), true); i++) {
				const entry = block + sizeof(PendingHeader) + i * sizeof(Extent);
				const offset = this.store.getUint32(entry + offsetof(Extent, 'offset'), true);
				const size = this.store.getUint32(entry + offsetof(Extent, 'size'), true);

				this.pendingBytes -= size;
				if (size == this.pageSize && this.availableBlocks() < 2 * this.lowWater()) this.pushSpare(offset);
				else this.freeExtent(offset, size);
			}

			const last = block == this.pendingTail;
			this.pendingHead = last ? 0 : this.store.getUint32(block + offsetof(PendingHeader, 'next'), true);
			if (last) this.pendingTail = 0;

			// The base commit still lists this block
			this.retire(block, this.pageSize);
		}
	}

	protected appendPending(offset: number, size: number): void {
		let tail = this.pendingTail;

		if (
			!tail
			|| this.store.getBigUint64(tail + offsetof(PendingHeader, 'generation'), true) !== this.generation
			|| this.store.getUint32(tail + offsetof(PendingHeader, 'count'), true)
				>= Math.floor((this.pageSize - sizeof(PendingHeader)) / sizeof(Extent))
		) {
			const block = this.alloc();
			this.store.setUint32(block + offsetof(PendingHeader, 'next'), 0, true);
			this.store.setUint32(block + offsetof(PendingHeader, 'count'), 0, true);
			this.store.setBigUint64(block + offsetof(PendingHeader, 'generation'), this.generation, true);

			// Earlier commits stop at their own tail
			if (tail) this.store.setUint32(tail + offsetof(PendingHeader, 'next'), block, true);
			else this.pendingHead = block;

			this.pendingTail = tail = block;
		}

		const count = this.store.getUint32(tail + offsetof(PendingHeader, 'count'), true);
		const entry = tail + sizeof(PendingHeader) + count * sizeof(Extent);
		this.store.setUint32(entry + offsetof(Extent, 'offset'), offset, true);
		this.store.setUint32(entry + offsetof(Extent, 'size'), size, true);
		this.store.setUint32(tail + offsetof(PendingHeader, 'count'), count + 1, true);
		this.pendingBytes += size;
	}

	/** Records retired extents in the pending list, then writes this transaction's roots and allocator state to `commit` */
	public commit(commit: Commit): void {
		while (this.retired.length) {
			const batch = this.retired;
			this.retired = [];
			for (const [offset, size] of batch) this.appendPending(offset, size);
		}

		for (const block of this.recycled) this.pushSpare(block);
		this.recycled = [];

		Object.assign(commit, {
			generation: this.generation,
			index_root: this.index.root,
			index_count: this.index.size,
			free_root: this.byOffset.root,
			size_root: this.bySize.root,
			free_count: this.byOffset.size,
			free_bytes: this.freeBytes,
			spare_head: this.spareHead,
			spare_count: this.spareCount,
			spare_total: this.spareTotal,
			pending_head: this.pendingHead,
			pending_tail: this.pendingTail,
			pending_bytes: this.pendingBytes,
		});
		commit.update();
	}
}
