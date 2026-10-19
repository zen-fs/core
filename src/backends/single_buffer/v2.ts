// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { alert, crit, debug, err } from 'kerium/log';
import type { ArrayOf } from 'memium';
import { array, offsetof, sizeof } from 'memium';
import { BPlusTree, type BPlusTreeStorage } from 'memium/bplustree';
import { $from, field, struct, types as t } from 'memium/decorators';
import { EpochTable, Mutex } from 'memium/locks';
import { types as primitive } from 'memium/primitives';
import { Void } from 'memium/types';
import type { UUID } from 'node:crypto';
import { _throw } from 'utilium';
import { BufferView } from 'utilium/buffer';
import { crc32c } from 'utilium/checksum';
import { decodeUUID, encodeUUID } from 'utilium/string';
import type { UsageInfo } from '../../internal/filesystem.js';
import { _inode_version, Inode } from '../../internal/inode.js';
import type { StoreFS } from '../store/fs.js';
import { SyncMapTransaction, type SyncMapStore } from '../store/map.js';
import type { Store } from '../store/store.js';
import { sb_magic } from './v1.js';

const hex = (value: number | bigint): string => '0x' + value.toString(16).padStart(8, '0');

const default_epoch_slots = 64;
const default_block_size = 4096;

/** Most spare blocks for tree nodes when a file system is created */
const initial_spares = 16;

/** Offsets are 32 bits */
const max_size = 0xffffffff;

/** Highest ID that fits in an inode */
const max_id = 0xffffffffn;

/** A range of bytes */
@struct.packed()
export class Extent extends $from(BufferView) {
	static name = 'sbfs.Extent';

	@t.uint32 accessor offset!: number;
	@t.uint32 accessor size!: number;
}

/** Where the data for an ID is stored */
@struct.packed()
export class DataExtent extends Extent {
	static name = 'sbfs.DataExtent';

	/** Bytes allocated, which can exceed `size` so data can grow in place */
	@t.uint32 accessor capacity!: number;
}

/** The roots and allocator state written by a transaction */
@struct.packed()
export class Commit extends $from(BufferView) {
	static name = 'sbfs.Commit';

	/** crc32c of the rest of the commit */
	@t.uint32 accessor checksum!: number;

	@t.uint64 accessor generation!: bigint;

	/** ID to extent */
	@t.uint32 accessor index_root!: number;
	@t.uint32 accessor index_count!: number;

	/** Free extents by offset */
	@t.uint32 accessor free_root!: number;

	/** Free extents by size then offset */
	@t.uint32 accessor size_root!: number;

	@t.uint32 accessor free_count!: number;
	@t.uint32 accessor free_bytes!: number;

	/** The newest block in the list of spare blocks for tree nodes */
	@t.uint32 accessor spare_head!: number;

	/** Spare blocks listed by `spare_head` */
	@t.uint32 accessor spare_count!: number;

	/** Spare blocks in the entire list */
	@t.uint32 accessor spare_total!: number;

	/** Blocks listing extents that are free once no reader can see them */
	@t.uint32 accessor pending_head!: number;
	@t.uint32 accessor pending_tail!: number;
	@t.uint32 accessor pending_bytes!: number;

	protected computeChecksum(): number {
		return crc32c(new Uint8Array(this.buffer, this.byteOffset + 4, sizeof(Commit) - 4));
	}

	public update(): void {
		this.checksum = this.computeChecksum();
	}

	public isValid(generation: bigint): boolean {
		return this.generation === generation && this.checksum == this.computeChecksum();
	}
}

/** State shared by every thread using a file system, which is followed by an epoch table */
@struct.packed()
export class State extends $from(BufferView) {
	static name = 'sbfs.State';

	/** Held by writers */
	@t.uint64 accessor lock!: bigint;

	/** The generation of the current commit */
	@t.uint64 accessor generation!: bigint;

	@t.uint64 accessor next_id!: bigint;

	/** The current and previous commits, at their generation modulo 2 */
	@field(array(Commit, 2)) accessor commits!: ArrayOf<Commit>;
}

/** The start of a block listing extents retired by a generation, which is followed by the extents */
@struct.packed()
export class PendingHeader extends $from(BufferView) {
	static name = 'sbfs.PendingHeader';

	@t.uint32 accessor next!: number;
	@t.uint32 accessor count!: number;
	@t.uint64 accessor generation!: bigint;
}

/**
 * The start of a block listing spare blocks, which is followed by their offsets.
 * The newest block's count is in the commit instead.
 */
@struct.packed()
export class SpareHeader extends $from(BufferView) {
	static name = 'sbfs.SpareHeader';

	@t.uint32 accessor next!: number;
	@t.uint32 accessor count!: number;
}

/**
 * The super block for version 2 of the single-buffer format.
 * Bytes 0 through 12 have the same layout in every version.
 */
@struct.packed()
export class SuperBlock extends $from(BufferView) {
	static name = 'SuperBlockV2';

	/** crc32c of the bytes from 4 up to `lock` */
	@t.uint32 accessor checksum!: number;

	@t.uint32 accessor magic!: number;

	/**
	 * The version of the on-disk format
	 * 1: v1.10.0+, append-only metadata blocks
	 * 2: copy-on-write B+ trees
	 */
	@t.uint16 accessor version!: number;

	/** Which format of `Inode` is used */
	@t.uint16 accessor inode_format!: number;

	/** Features that must be supported to mount the file system. None are defined. */
	@t.uint32 accessor required_features!: number;

	/** Features that may be ignored. None are defined. */
	@t.uint32 accessor optional_features!: number;

	/** Size of tree nodes and other metadata blocks */
	@t.uint32 accessor block_size!: number;

	/** The size of the entire file system, including the super block */
	@t.uint64 accessor total_bytes!: bigint;

	@t.uint8(16) accessor uuid!: Uint8Array;

	/** Byte offset of the shared state */
	@t.uint32 accessor state_offset!: number;

	@t.uint32 accessor epoch_slots!: number;

	/** An optional label for the file system */
	@t.char(64) accessor label!: Uint8Array;

	@t.char(128) protected accessor _padding!: Uint8Array;

	/** Held while the file system is created or upgraded. Not covered by the checksum. */
	@t.uint64 accessor lock!: bigint;

	protected computeChecksum(): number {
		return crc32c(new Uint8Array(this.buffer, this.byteOffset + 4, offsetof(SuperBlock, 'lock') - 4));
	}

	public update(): void {
		this.checksum = this.computeChecksum();
	}

	/** Checks that a file system of `byteLength` bytes can be mounted using this super block */
	public validate(byteLength: number): void {
		const { block_size } = this;
		if (this.version != 2) throw crit(withErrno('EIO', `sbfs: unsupported version ${this.version}`));
		if (this.checksum != this.computeChecksum()) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for super block'));
		if (this.required_features) throw crit(withErrno('EIO', `sbfs: unsupported features 0x${this.required_features.toString(16)}`));
		if (this.inode_format != _inode_version) throw crit(withErrno('EIO', 'sbfs: inode format mismatch'));
		if (this.total_bytes > BigInt(Math.min(byteLength, max_size))) throw crit(withErrno('EIO', 'sbfs: buffer is smaller than the file system'));
		if (block_size < 512 || block_size > 0x10000 || block_size & (block_size - 1))
			throw crit(withErrno('EIO', `sbfs: invalid block size ${block_size}`));
		if (!this.epoch_slots) throw crit(withErrno('EIO', 'sbfs: no epoch slots'));
		if ((this.byteOffset + this.state_offset) % 8) throw crit(withErrno('EIO', 'sbfs: misaligned shared state'));
	}
}

/** Key for the free tree ordered by size */
const sizeKey = (size: number, offset: number): bigint => (BigInt(size) << 32n) | BigInt(offset);

/** Thrown when the free trees need more blocks than there are spares */
const sparesExhausted = withErrno('ENOSPC', 'sbfs: no spare blocks');

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

	// Pending extents

	/** Frees extents retired by generations that readers no longer see */
	protected releasePending(oldest: bigint | undefined): void {
		const { store } = this;

		while (this.pendingHead) {
			const block = this.pendingHead;
			if (oldest !== undefined && store.getBigUint64(block + offsetof(PendingHeader, 'generation'), true) > oldest) break;

			const extents: [offset: number, size: number][] = [];
			for (let i = 0; i < store.getUint32(block + offsetof(PendingHeader, 'count'), true); i++) {
				const entry = block + sizeof(PendingHeader) + i * sizeof(Extent);
				extents.push([store.getUint32(entry + offsetof(Extent, 'offset'), true), store.getUint32(entry + offsetof(Extent, 'size'), true)]);
			}

			// Released blocks become spares, up to twice the low-water mark
			for (const extent of extents) {
				while (extent[1] >= this.pageSize && this.availableBlocks() < 2 * this.lowWater()) {
					this.pushSpare(extent[0]);
					this.pendingBytes -= this.pageSize;
					extent[0] += this.pageSize;
					extent[1] -= this.pageSize;
				}
			}

			for (const [offset, size] of extents) {
				this.pendingBytes -= size;
				this.freeExtent(offset, size);
			}

			const last = block == this.pendingTail;
			this.pendingHead = last ? 0 : store.getUint32(block + offsetof(PendingHeader, 'next'), true);
			if (last) this.pendingTail = 0;

			// The base commit still lists this block
			this.retire(block, this.pageSize);
		}
	}

	protected appendPending(offset: number, size: number): void {
		const { store } = this;
		let tail = this.pendingTail;

		if (
			!tail
			|| store.getBigUint64(tail + offsetof(PendingHeader, 'generation'), true) !== this.generation
			|| store.getUint32(tail + offsetof(PendingHeader, 'count'), true) >= Math.floor((this.pageSize - sizeof(PendingHeader)) / sizeof(Extent))
		) {
			const block = this.alloc();
			store.setUint32(block + offsetof(PendingHeader, 'next'), 0, true);
			store.setUint32(block + offsetof(PendingHeader, 'count'), 0, true);
			store.setBigUint64(block + offsetof(PendingHeader, 'generation'), this.generation, true);

			// Earlier commits stop at their own tail
			if (tail) store.setUint32(tail + offsetof(PendingHeader, 'next'), block, true);
			else this.pendingHead = block;

			this.pendingTail = tail = block;
		}

		const count = store.getUint32(tail + offsetof(PendingHeader, 'count'), true);
		const entry = tail + sizeof(PendingHeader) + count * sizeof(Extent);
		store.setUint32(entry + offsetof(Extent, 'offset'), offset, true);
		store.setUint32(entry + offsetof(Extent, 'size'), size, true);
		store.setUint32(tail + offsetof(PendingHeader, 'count'), count + 1, true);
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

export interface FormatOptions {
	/** Byte ranges that are already in use */
	used?: [start: number, end: number][];
	uuid?: Uint8Array;
	label?: Uint8Array;

	/** The first ID to allocate */
	nextId?: bigint;

	/** Adds existing data in the first transaction */
	populate?(tx: WriteTransaction): void;
}

export interface SingleBufferStoreOptions {
	/** Erases the buffer and creates a new file system */
	format?: boolean | FormatOptions;
}

const defaultStateSize = sizeof(State) + EpochTable.sizeOf(default_epoch_slots);

/**
 * A store for version 2 of the single-buffer format.
 *
 * Every change is a transaction that copies what it modifies.
 * Readers never block, and an interrupted writer does not change the file system.
 * @category Stores and Transactions
 */
export class SingleBufferStore extends DataView<ArrayBufferLike> implements SyncMapStore {
	public readonly flags = ['partial'] as const;
	public readonly name = 'sbfs';
	public readonly type = 0x73626673; // 'sbfs'

	public get uuid(): UUID {
		return decodeUUID(this.superblock.uuid);
	}

	protected readonly superblock: SuperBlock;

	/**
	 * The entire file system
	 * @internal
	 */
	public readonly bytes: Uint8Array;

	/** @internal */
	public readonly blockSize: number;

	/** @internal */
	public readonly epochs: EpochTable;

	protected readonly mutex: Mutex;
	protected readonly generation: BigInt64Array;
	protected readonly nextId: BigInt64Array;
	protected readonly commits: [Commit, Commit];

	/** The index of the version being read */
	protected readonly index: BPlusTree<bigint, DataExtent>;

	/**
	 * Opens a file system, or creates one if `format` is set.
	 * When creating one, byte ranges in `used` are kept, and the first transaction runs `populate` after making everything else free.
	 */
	public constructor(
		buffer: ArrayBufferLike | ArrayBufferView,
		byteOffset: number = 0,
		byteLength?: number,
		options: SingleBufferStoreOptions = {},
	) {
		if (ArrayBuffer.isView(buffer)) super(buffer.buffer, buffer.byteOffset + byteOffset, byteLength ?? buffer.byteLength - byteOffset);
		else super(buffer, byteOffset, byteLength);

		if (this.byteOffset % 8) throw crit(withErrno('EINVAL', 'sbfs: buffer must be 8-byte aligned'));
		if (this.byteLength < sizeof(SuperBlock)) throw crit(withErrno('EINVAL', 'sbfs: buffer is too small for a file system'));

		this.bytes = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
		this.superblock = new SuperBlock(this.buffer, this.byteOffset);

		const format = options.format === true ? {} : options.format;
		let { superblock } = this;
		const gaps: [start: number, end: number][] = [];
		let spares = 0,
			spareBlocks = 0;

		if (!format) this.superblock.validate(this.byteLength);
		else {
			if (this.byteLength > max_size) throw crit(withErrno('EINVAL', 'sbfs: buffers larger than 4 GiB are not supported'));

			const used: [start: number, end: number][] = [[0, sizeof(SuperBlock)], ...(format.used ?? [])];
			used.sort(([a], [b]) => a - b);

			let cursor = 0;
			for (const [start, end] of used) {
				if (start > cursor) gaps.push([cursor, start]);
				cursor = Math.max(cursor, end);
			}
			if (cursor < this.byteLength) gaps.push([cursor, this.byteLength]);

			const take = (size: number, alignment: number): number => {
				const align = (start: number) => Math.ceil((this.byteOffset + start) / alignment) * alignment - this.byteOffset;
				const index = gaps.findIndex(([start, end]) => align(start) + size <= end);
				if (index == -1) throw crit(withErrno('ENOSPC', 'sbfs: buffer is too small for a file system'));

				const [start, end] = gaps[index];
				const aligned = align(start);
				const rest: [number, number][] = [
					[start, aligned],
					[aligned + size, end],
				];
				gaps.splice(index, 1, ...rest.filter(([s, e]) => e > s));
				return aligned;
			};

			superblock = new SuperBlock();
			Object.assign(superblock, {
				magic: sb_magic,
				version: 2,
				inode_format: _inode_version,
				block_size: default_block_size,
				epoch_slots: default_epoch_slots,
				total_bytes: BigInt(this.byteLength),
				uuid: format.uuid ?? encodeUUID(crypto.randomUUID()),
				state_offset: take(defaultStateSize, 8),
			});
			if (format.label) superblock.label = format.label;

			const free = gaps.reduce((total, [start, end]) => total + end - start, 0);
			spareBlocks = Math.min(initial_spares, Math.floor(free / superblock.block_size / 4));
			if (spareBlocks < 4) throw crit(withErrno('EINVAL', 'sbfs: buffer is too small for a file system'));
			spares = take(spareBlocks * superblock.block_size, 1);
		}

		const { block_size, state_offset, epoch_slots } = superblock;
		const state = this.byteOffset + state_offset;
		const commits = state + offsetof(State, 'commits');

		this.blockSize = block_size;
		this.mutex = new Mutex(this.buffer, state + offsetof(State, 'lock'));
		this.generation = new BigInt64Array(this.buffer, state + offsetof(State, 'generation'), 1);
		this.nextId = new BigInt64Array(this.buffer, state + offsetof(State, 'next_id'), 1);
		this.commits = [new Commit(this.buffer, commits), new Commit(this.buffer, commits + sizeof(Commit))];
		this.epochs = new EpochTable(this.buffer, state + sizeof(State), epoch_slots);

		const readOnly: BPlusTreeStorage = {
			buffer: this.buffer,
			pageSize: this.blockSize,
			offsetOf: block => this.byteOffset + block,
			alloc: () => _throw(withErrno('EROFS', 'sbfs: snapshots are read-only')),
			free: () => _throw(withErrno('EROFS', 'sbfs: snapshots are read-only')),
		};
		this.index = new BPlusTree<bigint, DataExtent>(readOnly, { key: primitive.uint64, value: DataExtent });

		if (!format) {
			if (!this.withCurrentCommit((commit, generation) => commit.isValid(generation)))
				throw crit(withErrno('EIO', 'sbfs: the current commit is corrupt'));
			return;
		}

		this.bytes.fill(0, state_offset, state_offset + defaultStateSize);
		Atomics.store(this.nextId, 0, format.nextId ?? 2n);
		this.setUint32(spares + offsetof(SpareHeader, 'next'), 0, true);
		for (let i = 1; i < spareBlocks; i++) this.setUint32(spares + sizeof(SpareHeader) + (i - 1) * 4, spares + i * block_size, true);
		Object.assign(this.commits[0], { spare_head: spares, spare_count: spareBlocks - 1, spare_total: spareBlocks - 1 });
		this.commits[0].update();

		this.write(tx => {
			for (const [start, end] of gaps) tx.freeExtent(start, end - start);
			format.populate?.(tx);
		});

		superblock.lock = Atomics.load(new BigInt64Array(this.buffer, this.byteOffset + offsetof(SuperBlock, 'lock'), 1), 0);
		superblock.update();
		this.bytes.set(new Uint8Array(superblock.buffer, superblock.byteOffset, sizeof(SuperBlock)), 0);
	}

	/** Reads the current commit, retrying if a writer replaces it while reading */
	protected withCurrentCommit<T>(read: (commit: Commit, generation: bigint) => T): T {
		for (;;) {
			const generation = Atomics.load(this.generation, 0);
			const result = read(this.commits[Number(generation & 1n)], generation);
			if (Atomics.load(this.generation, 0) === generation) return result;
		}
	}

	/** Runs `read` against the current version, which stays valid until `read` returns */
	protected read<T>(read: (index: BPlusTree<bigint, DataExtent>) => T): T {
		for (;;) {
			const generation = Atomics.load(this.generation, 0);
			using _ = this.epochs.pin(generation);
			const { index_root, index_count } = this.commits[Number(generation & 1n)];
			if (Atomics.load(this.generation, 0) !== generation) continue;
			this.index.reset(index_root, index_count);
			return read(this.index);
		}
	}

	/** Runs `change` in a write transaction, retrying with more spare blocks if the free trees run out of them */
	public write<T>(change: (tx: WriteTransaction) => T): T {
		using lock = this.mutex.lock();

		for (let attempt = 0; ; attempt++) {
			try {
				const generation = Atomics.load(this.generation, 0);
				const base = this.commits[Number(generation & 1n)];
				if (!base.isValid(generation)) throw crit(withErrno('EIO', `sbfs: commit for generation ${generation} is corrupt`));

				const tx = new WriteTransaction(this, base, 2 ** attempt);
				const result = change(tx);
				tx.commit(this.commits[Number(tx.generation & 1n)]);

				if (!lock.renew()) throw crit(withErrno('EBUSY', 'sbfs: lost the write lock before committing'));
				Atomics.store(this.generation, 0, tx.generation);
				return result;
			} catch (e) {
				if (e !== sparesExhausted || attempt >= 3) throw e;
				debug('sbfs: retrying transaction with more spare blocks');
			}
		}
	}

	// Store

	public keys(): number[] {
		return this.read(index => Array.from(index.keys(), Number));
	}

	public get(id: number, offset: number = 0, end?: number): Uint8Array | undefined {
		return this.read(index => {
			const extent = index.get(BigInt(id));
			if (!extent) return;
			const start = this.byteOffset + extent.offset;
			return new Uint8Array(this.buffer.slice(start + Math.min(offset, extent.size), start + Math.min(end ?? extent.size, extent.size)));
		});
	}

	public set(id: number, data: Uint8Array, offset?: number): void {
		if (id === 0 && offset === undefined && data.length < sizeof(Inode))
			throw alert(withErrno('EIO', `sbfs: tried to set ${data.length} bytes for id 0!`));

		const key = BigInt(id);

		this.write(tx => {
			const old = tx.index.get(key);
			const kept = offset === undefined ? 0 : (old?.size ?? 0);
			const start = offset ?? 0;
			const extent = Object.assign(new DataExtent(), { size: Math.max(kept, start + data.length) });

			// Bytes past the old size are not visible to readers of older versions
			if (old && offset !== undefined && start >= old.size && extent.size <= old.capacity) {
				extent.offset = old.offset;
				extent.capacity = old.capacity;
			} else {
				// Data that grows from partial writes gets room to keep growing
				const roomy = offset === undefined ? extent.size : Math.max(extent.size, Math.floor((old?.capacity ?? 0) * 1.5));
				extent.capacity = extent.size ? roomy : 0;
				try {
					extent.offset = extent.capacity ? tx.allocate(extent.capacity) : 0;
				} catch (e) {
					if (e === sparesExhausted || (e as { code?: string }).code != 'ENOSPC' || extent.capacity == extent.size) throw e;
					extent.capacity = extent.size;
					extent.offset = tx.allocate(extent.size);
				}

				if (old) {
					this.bytes.copyWithin(extent.offset, old.offset, old.offset + kept);
					tx.retire(old.offset, old.capacity);
				}
			}

			this.bytes.fill(0, extent.offset + kept, extent.offset + start);
			this.bytes.set(data, extent.offset + start);
			tx.index.set(key, extent);
		});
	}

	public delete(id: number): void {
		const key = BigInt(id);

		this.write(tx => {
			const old = tx.index.get(key);
			if (!old) return;
			tx.index.delete(key);
			tx.retire(old.offset, old.capacity);
		});
	}

	public allocId(): [ino: number, data: number] {
		const id = Atomics.add(this.nextId, 0, 2n);
		if (id + 1n > max_id) throw err(withErrno('ENOSPC', 'sbfs: no IDs available'));
		return [Number(id), Number(id + 1n)];
	}

	public usage(): UsageInfo {
		return {
			totalSpace: Number(this.superblock.total_bytes),
			freeSpace: this.withCurrentCommit(commit => commit.free_bytes + commit.spare_total * this.blockSize + commit.pending_bytes),
		};
	}

	protected _fs?: StoreFS<Store> | undefined;

	get fs(): StoreFS<Store> | undefined {
		return this._fs;
	}

	set fs(fs: StoreFS<Store> | undefined) {
		if (this.buffer.constructor.name === 'SharedArrayBuffer') fs?.attributes.set('no_id_tables', true);
		this._fs = fs;
	}

	public sync(): Promise<void> {
		return Promise.resolve();
	}

	public transaction(): SyncMapTransaction {
		return new SyncMapTransaction(this);
	}
}
