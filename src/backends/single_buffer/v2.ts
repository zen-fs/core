// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { alert, crit, debug, err, info, warn } from 'kerium/log';
import { offsetof, sizeof } from 'memium';
import { BPlusTree, type BPlusTreeStorage } from 'memium/bplustree';
import { $from, struct, types as t } from 'memium/decorators';
import { EpochTable, Mutex, type MutexGuard } from 'memium/locks';
import { types as primitive } from 'memium/primitives';
import { Void } from 'memium/types';
import type { UUID } from 'node:crypto';
import { BufferView } from 'utilium/buffer';
import { crc32c } from 'utilium/checksum';
import { decodeUUID, encodeUUID } from 'utilium/string';
import type { UsageInfo } from '../../internal/filesystem.js';
import { _inode_version, Inode } from '../../internal/inode.js';
import type { StoreFS } from '../store/fs.js';
import { SyncMapTransaction, type SyncMapStore } from '../store/map.js';
import type { Store } from '../store/store.js';
import * as v1 from './v1.js';

const hex = (value: number | bigint): string => '0x' + value.toString(16).padStart(8, '0');

export const sb_version = 2;
export const sb_size = 256;

/** The super block checksum covers bytes 4 up to this offset */
const sb_checksum_end = 128;

/** Offset of the lock held while upgrading, which is in the padding of a version 1 super block */
export const upgrade_lock_offset = 128;

const default_reader_slots = 64;
const default_block_size = 4096;

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

/**
 * A committed version of the file system.
 * There are two, and the current transaction ID selects which one is current.
 */
@struct.packed()
export class Meta extends $from(BufferView) {
	static name = 'Meta';

	/** crc32c of the rest of the meta */
	@t.uint32 accessor checksum!: number;
	@t.uint32 protected accessor _reserved!: number;
	@t.uint64 accessor txn!: bigint;

	/** ID to extent */
	@t.uint32 accessor index_root!: number;
	@t.uint32 accessor index_count!: number;

	/** Free extents by offset */
	@t.uint32 accessor free_root!: number;

	/** Free extents by size and offset */
	@t.uint32 accessor size_root!: number;

	@t.uint32 accessor free_count!: number;
	@t.uint32 accessor free_bytes!: number;

	/** Unused blocks set aside for tree nodes, so changing the free trees never needs the free trees */
	@t.uint32 accessor reserve_offset!: number;
	@t.uint32 accessor reserve_size!: number;

	/** Blocks listing extents that are free once no reader can see them */
	@t.uint32 accessor pending_head!: number;
	@t.uint32 accessor pending_tail!: number;
	@t.uint32 accessor pending_bytes!: number;

	@t.uint32 protected accessor _padding!: number;

	protected computeChecksum(): number {
		return crc32c(new Uint8Array(this.buffer, this.byteOffset + 4, sizeof(Meta) - 4));
	}

	public update(): void {
		this.checksum = this.computeChecksum();
	}

	public isValid(txn: bigint): boolean {
		return this.txn === txn && this.checksum == this.computeChecksum();
	}
}

/**
 * Layout of the shared state:
 * - Mutex for writers
 * - i64 current transaction
 * - i64 next ID
 * - 8 reserved bytes
 * - 2 metas
 * - reader table
 */
export const state_header = 32;

export function stateSize(slots: number): number {
	return state_header + 2 * sizeof(Meta) + EpochTable.sizeOf(slots);
}

/**
 * The start of a block listing extents freed by a transaction.
 * The rest of the block is extents.
 */
@struct.packed()
export class PendingHeader extends $from(BufferView) {
	static name = 'sbfs.PendingHeader';

	@t.uint32 accessor next!: number;
	@t.uint32 accessor count!: number;

	/** The transaction that freed the extents */
	@t.uint64 accessor txn!: bigint;
}

const pending = {
	next: offsetof(PendingHeader, 'next'),
	count: offsetof(PendingHeader, 'count'),
	txn: offsetof(PendingHeader, 'txn'),
	entries: sizeof(PendingHeader),
	offset: offsetof(Extent, 'offset'),
	size: offsetof(Extent, 'size'),
};

/**
 * The super block for version 2 of the single-buffer format.
 * Bytes 0 through 12 have the same layout in every version.
 */
@struct.packed()
export class SuperBlock extends $from(BufferView) {
	static name = 'SuperBlockV2';

	/** crc32c of bytes 4 through 128 */
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
	@t.uint32 accessor incompat!: number;

	/** Features that may be ignored. None are defined. */
	@t.uint32 accessor compat!: number;

	/** Size of tree nodes and other metadata blocks */
	@t.uint32 accessor block_size!: number;

	/** The size of the entire file system, including the super block */
	@t.uint64 accessor total_bytes!: bigint;

	@t.uint8(16) accessor uuid!: Uint8Array;

	/** Byte offset of the shared state */
	@t.uint32 accessor state_offset!: number;

	@t.uint16 accessor reader_slots!: number;

	@t.uint16 protected accessor _reserved0!: number;

	/** An optional label for the file system */
	@t.char(64) accessor label!: Uint8Array;

	@t.uint64 protected accessor _reserved1!: bigint;

	/** Only used while upgrading. Not covered by the checksum. */
	@t.uint64 accessor upgrade_lock!: bigint;

	@t.char(120) protected accessor _padding!: Uint8Array;

	/** Creates a super block outside of a file system, so it can be written all at once */
	public static default(totalBytes: number, stateOffset: number): SuperBlock {
		const sb = new SuperBlock();
		Object.assign(sb, {
			magic: v1.sb_magic,
			version: sb_version,
			inode_format: _inode_version,
			block_size: default_block_size,
			reader_slots: default_reader_slots,
			total_bytes: BigInt(totalBytes),
			uuid: encodeUUID(crypto.randomUUID()),
			state_offset: stateOffset,
		});
		return sb;
	}

	protected computeChecksum(): number {
		return crc32c(new Uint8Array(this.buffer, this.byteOffset + 4, sb_checksum_end - 4));
	}

	public update(): void {
		this.checksum = this.computeChecksum();
	}

	/** Checks that a file system of `byteLength` bytes can be mounted using this super block */
	public validate(byteLength: number): void {
		const { block_size } = this;
		if (this.version != sb_version) throw crit(withErrno('EIO', `sbfs: unsupported version ${this.version}`));
		if (this.checksum != this.computeChecksum()) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for super block'));
		if (this.incompat) throw crit(withErrno('EIO', `sbfs: unsupported features 0x${this.incompat.toString(16)}`));
		if (this.inode_format != _inode_version) throw crit(withErrno('EIO', 'sbfs: inode format mismatch'));
		if (this.total_bytes > BigInt(Math.min(byteLength, max_size))) throw crit(withErrno('EIO', 'sbfs: buffer is smaller than the file system'));
		if (block_size < 512 || block_size > 0x10000 || block_size & (block_size - 1))
			throw crit(withErrno('EIO', `sbfs: invalid block size ${block_size}`));
		if (!this.reader_slots) throw crit(withErrno('EIO', 'sbfs: no reader slots'));
		if ((this.byteOffset + this.state_offset) % 8) throw crit(withErrno('EIO', 'sbfs: misaligned shared state'));
	}
}

/** Key for the free tree ordered by size */
const sizeKey = (size: number, offset: number): bigint => (BigInt(size) << 32n) | BigInt(offset);

/** Mutable copy of the parts of a meta not tracked by the trees */
interface TxnState {
	txn: bigint;
	free_bytes: number;
	reserve_offset: number;
	reserve_size: number;
	pending_head: number;
	pending_tail: number;
	pending_bytes: number;
}

/** Thrown when the free trees need more blocks than the reserve has, so the transaction is retried with a larger reserve */
const reserveExhausted = withErrno('ENOSPC', 'sbfs: block reserve exhausted');

/** Checksum of a version 1 super block, treating the upgrade lock as zero */
function v1Checksum(bytes: Uint8Array): number {
	const data = bytes.slice(4, sb_size);
	data.fill(0, upgrade_lock_offset - 4, upgrade_lock_offset + 4);
	return crc32c(data);
}

/**
 * A store for version 2 of the single-buffer format.
 * Opening a version 1 file system upgrades it.
 *
 * Every change is a transaction that copies what it modifies and is published by atomically storing the new transaction ID,
 * so readers never block and an interrupted writer never corrupts the file system.
 * @category Stores and Transactions
 */
export class SingleBufferStoreV2 extends DataView<ArrayBufferLike> implements SyncMapStore {
	public readonly flags = [] as const;
	public readonly name = 'sbfs';
	public readonly type = 0x73626673; // 'sbfs'

	public get uuid(): UUID {
		return decodeUUID(this.superblock.uuid);
	}

	protected superblock: SuperBlock;

	/** The entire file system */
	protected readonly bytes: Uint8Array;

	protected blockSize!: number;
	protected pendingCapacity!: number;

	protected mutex!: Mutex;
	protected readers!: EpochTable;
	protected txn!: BigInt64Array;
	protected nextId!: BigInt64Array;
	protected metas!: [Meta, Meta];

	protected index!: BPlusTree<bigint, Extent>;
	protected byOffset!: BPlusTree<number, number>;
	protected bySize!: BPlusTree<bigint, void>;
	protected snapshotIndex!: BPlusTree<bigint, Extent>;

	protected state!: TxnState;

	/** Blocks allocated by the current transaction */
	protected readonly fresh = new Set<number>();

	/** Blocks no committed version references, which can be reused immediately */
	protected recycled: number[] = [];

	/** Extents that become free once no reader can see them */
	protected freed: [offset: number, size: number][] = [];

	/** Whether the free trees are being changed, so the reserve must not be refilled */
	protected inAllocator = false;

	protected reserveScale = 1;

	public constructor(buffer: ArrayBufferLike | ArrayBufferView, byteOffset: number = 0, byteLength?: number) {
		if (ArrayBuffer.isView(buffer)) super(buffer.buffer, buffer.byteOffset + byteOffset, byteLength ?? buffer.byteLength - byteOffset);
		else super(buffer, byteOffset, byteLength);

		if (this.byteOffset % 8) throw crit(withErrno('EINVAL', 'sbfs: buffer must be 8-byte aligned'));
		if (this.byteLength < sb_size) throw crit(withErrno('EINVAL', 'sbfs: buffer is too small for a file system'));

		this.bytes = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
		this.superblock = new SuperBlock(this.buffer, this.byteOffset);

		if (this.superblock.magic != v1.sb_magic) this.format();
		else if (this.superblock.version < sb_version) this.upgrade();
		else this.mount();
	}

	/* Setup */

	/** Sets up runtime state using the layout described by `layout`, which may not be written yet */
	protected attach(layout: SuperBlock): void {
		this.blockSize = layout.block_size;
		this.pendingCapacity = Math.floor((this.blockSize - pending.entries) / sizeof(Extent));

		const base = this.byteOffset + layout.state_offset;
		this.mutex = new Mutex(this.buffer, base);
		this.txn = new BigInt64Array(this.buffer, base + 8, 1);
		this.nextId = new BigInt64Array(this.buffer, base + 16, 1);
		this.metas = [new Meta(this.buffer, base + state_header), new Meta(this.buffer, base + state_header + sizeof(Meta))];
		this.readers = new EpochTable(this.buffer, base + state_header + 2 * sizeof(Meta), layout.reader_slots);

		const blocks: BPlusTreeStorage = {
			buffer: this.buffer,
			pageSize: this.blockSize,
			alloc: () => this.allocBlock(),
			free: block => this.freeBlock(block),
			offsetOf: block => this.byteOffset + block,
		};

		this.index = new BPlusTree<bigint, Extent>(blocks, { key: primitive.uint64, value: Extent });
		this.snapshotIndex = new BPlusTree<bigint, Extent>(blocks, { key: primitive.uint64, value: Extent });
		this.byOffset = new BPlusTree(blocks, { key: primitive.uint32, value: primitive.uint32 });
		this.bySize = new BPlusTree(blocks, { key: primitive.uint64, value: Void });
	}

	protected mount(): void {
		this.superblock.validate(this.byteLength);
		this.attach(this.superblock);

		// Writers may commit while this checks, so only a version that stayed current can be corrupt
		for (;;) {
			const txn = Atomics.load(this.txn, 0);
			const valid = this.metas[Number(txn & 1n)].isValid(txn);
			if (Atomics.load(this.txn, 0) !== txn) continue;
			if (!valid) throw crit(withErrno('EIO', `sbfs: metadata for transaction ${txn} is corrupt`));
			return;
		}
	}

	/** Writes a draft over the super block with a single copy, so it can not be torn */
	protected writeSuperBlock(draft: SuperBlock): void {
		draft.update();
		this.bytes.set(new Uint8Array(draft.buffer, draft.byteOffset, sb_size), 0);
	}

	/**
	 * Initializes the shared state and commits the first transaction.
	 * The initial reserve is used to build the free trees.
	 */
	protected bootstrap(layout: SuperBlock, reserve: number, reserveBlocks: number, nextId: bigint, build: () => void): void {
		const base = this.byteOffset + layout.state_offset;
		new Uint8Array(this.buffer, base, stateSize(layout.reader_slots)).fill(0);

		Atomics.store(this.nextId, 0, nextId);
		Object.assign(this.metas[0], { reserve_offset: reserve, reserve_size: reserveBlocks * this.blockSize });
		this.metas[0].update();

		this.transact(build);
	}

	protected format(): void {
		if (this.byteLength > max_size) throw crit(withErrno('EINVAL', 'sbfs: buffers larger than 4 GiB are not supported'));

		const draft = SuperBlock.default(this.byteLength, sb_size);
		this.attach(draft);

		const first = sb_size + stateSize(draft.reader_slots);
		const reserveBlocks = Math.min(16, Math.floor((this.byteLength - first) / this.blockSize / 4));

		if (reserveBlocks < 4) throw crit(withErrno('EINVAL', 'sbfs: buffer is too small for a file system'));

		const free = first + reserveBlocks * this.blockSize;
		this.bootstrap(draft, first, reserveBlocks, 2n, () => this.freeExtent(free, this.byteLength - free));

		this.writeSuperBlock(draft);
	}

	/**
	 * Upgrades a version 1 file system in place.
	 * Existing data is not moved, and the version 1 metadata stays intact until the new super block is written,
	 * so an interrupted upgrade leaves a valid version 1 file system.
	 */
	protected upgrade(): void {
		const lockWord = new BigInt64Array(this.buffer, this.byteOffset + upgrade_lock_offset, 1);

		// The padding of a version 1 super block was never cleared, so the lock may contain garbage
		const garbage = Atomics.load(lockWord, 0);
		if (garbage && crc32c(this.bytes.subarray(4, sb_size)) == this.getUint32(0, true)) {
			if (Atomics.compareExchange(lockWord, 0, garbage, 0n) === garbage) this.setUint32(0, v1Checksum(this.bytes), true);
		}

		using lock = new Mutex(this.buffer, this.byteOffset + upgrade_lock_offset).lock();

		switch (this.superblock.version) {
			case 0:
			case 1:
				this.convert(lock);
				return;
			case sb_version:
				this.mount();
				return;
			default:
				throw crit(withErrno('EIO', 'sbfs: unsupported version'));
		}
	}

	protected convert(lock: MutexGuard): void {
		info('sbfs: upgrading from version 1');

		const field = (name: string) => offsetof(v1.SuperBlock, name);

		if (v1Checksum(this.bytes) != this.getUint32(0, true)) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for version 1 super block'));
		if (this.superblock.inode_format != _inode_version) throw crit(withErrno('EIO', 'sbfs: inode format mismatch'));
		if (this.getUint32(field('metadata_block_size'), true) != sizeof(v1.MetadataBlock))
			throw crit(withErrno('EIO', 'sbfs: metadata block size mismatch'));

		const total = Number(this.getBigUint64(field('total_bytes'), true));
		if (total > this.byteLength || total > max_size) throw crit(withErrno('EIO', 'sbfs: invalid size in version 1 super block'));

		const used: [start: number, end: number][] = [[0, sb_size]];
		const entries = new Map<number, Extent>();
		const blocks: number[] = [];

		// Version 1 metadata block offsets are relative to the buffer, but data offsets are relative to the file system
		for (let absolute = this.getUint32(field('metadata_offset'), true); absolute;) {
			const offset = absolute - this.byteOffset;
			if (offset < sb_size || offset + sizeof(v1.MetadataBlock) > total || blocks.includes(offset))
				throw crit(withErrno('EIO', `sbfs: invalid metadata block at ${hex(absolute)}`));

			const block = new v1.MetadataBlock(this.buffer, absolute);
			if (block.checksum != v1.checksum(block)) {
				if (!blocks.length) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for metadata block'));
				warn(`sbfs: checksum mismatch for metadata block at ${hex(absolute)}`);
			}

			blocks.push(offset);
			used.push([offset, offset + sizeof(v1.MetadataBlock)]);

			for (const entry of block.items) {
				if (!entry.offset || entries.has(entry.id)) continue;
				if (entry.offset + entry.size > total) throw crit(withErrno('EIO', `sbfs: data for ${hex(entry.id)} is out of bounds`));

				entries.set(entry.id, Object.assign(new Extent(), { offset: entry.size ? entry.offset : 0, size: entry.size }));
				if (entry.size) used.push([entry.offset, entry.offset + entry.size]);
			}

			absolute = block.previous_offset;
		}

		used.sort(([a], [b]) => a - b);
		const gaps: [start: number, end: number][] = [];
		let cursor = 0;
		for (const [start, end] of used) {
			if (start > cursor) gaps.push([cursor, start]);
			cursor = Math.max(cursor, end);
		}
		if (cursor < total) gaps.push([cursor, total]);

		const take = (size: number, alignment: number): number => {
			const align = (start: number) => Math.ceil((this.byteOffset + start) / alignment) * alignment - this.byteOffset;
			const index = gaps.findIndex(([start, end]) => align(start) + size <= end);
			if (index == -1) throw crit(withErrno('ENOSPC', 'sbfs: not enough free space to upgrade'));

			const [start, end] = gaps[index];
			const aligned = align(start);
			const rest: [number, number][] = [
				[start, aligned],
				[aligned + size, end],
			];
			gaps.splice(index, 1, ...rest.filter(([s, e]) => e > s));
			return aligned;
		};

		const draft = SuperBlock.default(this.byteLength, 0);
		draft.state_offset = take(stateSize(draft.reader_slots), 8);
		draft.uuid = this.superblock.uuid.slice();
		draft.label = this.bytes.slice(field('label'), field('label') + 64);
		this.attach(draft);

		const reserveBlocks = 16;
		const reserve = take(reserveBlocks * this.blockSize, 1);

		let maxId = 0;
		for (const id of entries.keys()) maxId = Math.max(maxId, id);

		this.bootstrap(draft, reserve, reserveBlocks, BigInt(Math.max(2, maxId + 1)), () => {
			for (const [start, end] of gaps) this.freeExtent(start, end - start);
			for (const [id, extent] of entries) this.index.set(BigInt(id), extent);
			for (const block of blocks) this.freed.push([block, sizeof(v1.MetadataBlock)]);
		});

		draft.upgrade_lock = Atomics.load(new BigInt64Array(this.buffer, this.byteOffset + upgrade_lock_offset, 1), 0);
		this.writeSuperBlock(draft);
		lock.renew();

		info(`sbfs: upgraded ${entries.size} entries from version 1`);
	}

	/* Transactions */

	/** The meta for the current transaction. Only call this while holding the write lock. */
	protected currentMeta(txn: bigint): Meta {
		const meta = this.metas[Number(txn & 1n)];
		if (!meta.isValid(txn)) throw crit(withErrno('EIO', `sbfs: metadata for transaction ${txn} is corrupt`));
		return meta;
	}

	/** Runs `op` as a write transaction, retrying with a larger reserve if the free trees run out of blocks */
	protected transact<T>(op: () => T): T {
		using lock = this.mutex.lock();

		for (let attempt = 0; ; attempt++) {
			this.reserveScale = 2 ** attempt;
			try {
				this.begin();
				const result = op();
				this.commit(lock);
				return result;
			} catch (e) {
				if (e !== reserveExhausted || attempt >= 3) throw e;
				debug('sbfs: retrying transaction with a larger reserve');
			}
		}
	}

	protected begin(): void {
		const txn = Atomics.load(this.txn, 0);
		const meta = this.currentMeta(txn);

		const { free_bytes, reserve_offset, reserve_size, pending_head, pending_tail, pending_bytes } = meta;
		this.state = { txn, free_bytes, reserve_offset, reserve_size, pending_head, pending_tail, pending_bytes };

		this.index.reset(meta.index_root, meta.index_count);
		this.byOffset.reset(meta.free_root, meta.free_count);
		this.bySize.reset(meta.size_root, meta.free_count);
		this.fresh.clear();
		this.recycled = [];
		this.freed = [];
		this.inAllocator = false;

		this.releasePending();
	}

	protected commit(lock: MutexGuard): void {
		const txn = this.state.txn + 1n;

		this.flush(txn);

		const meta = this.metas[Number(txn & 1n)];
		Object.assign(meta, {
			...this.state,
			txn,
			index_root: this.index.root,
			index_count: this.index.size,
			free_root: this.byOffset.root,
			size_root: this.bySize.root,
			free_count: this.byOffset.size,
		});
		meta.update();

		if (!lock.renew()) throw crit(withErrno('EBUSY', 'sbfs: lost the write lock before committing'));

		Atomics.store(this.txn, 0, txn);

		this.index.checkpoint();
		this.byOffset.checkpoint();
		this.bySize.checkpoint();
	}

	/** Runs `read` against the current version, which stays valid until `read` returns */
	protected snapshot<T>(read: (index: BPlusTree<bigint, Extent>) => T): T {
		for (;;) {
			const txn = Atomics.load(this.txn, 0);
			using _ = this.readers.pin(txn);
			const meta = this.metas[Number(txn & 1n)];
			const root = meta.index_root,
				count = meta.index_count;
			if (meta.txn !== txn || Atomics.load(this.txn, 0) !== txn) continue;
			this.snapshotIndex.reset(root, count);
			return read(this.snapshotIndex);
		}
	}

	/* Pending extents */

	/** Frees extents from transactions no reader can see */
	protected releasePending(): void {
		const oldest = this.readers.oldest();

		while (this.state.pending_head) {
			const block = this.state.pending_head;
			if (oldest !== undefined && this.getBigUint64(block + pending.txn, true) > oldest) break;

			const extents: [offset: number, size: number][] = [];
			for (let i = 0; i < this.getUint32(block + pending.count, true); i++) {
				const entry = block + pending.entries + i * sizeof(Extent);
				extents.push([this.getUint32(entry + pending.offset, true), this.getUint32(entry + pending.size, true)]);
			}

			// Updating the free trees needs blocks, which fragmented free space may not have
			for (const extent of extents) {
				const [offset, size] = extent;
				if (size < this.blockSize || this.availableBlocks() >= this.lowWater()) continue;
				const whole = size - (size % this.blockSize);
				this.state.pending_bytes -= whole;
				this.addToReserve(offset, whole);
				extent[0] += whole;
				extent[1] -= whole;
			}

			for (const [offset, size] of extents) {
				this.state.pending_bytes -= size;
				this.freeExtent(offset, size);
			}

			const last = block == this.state.pending_tail;
			this.state.pending_head = last ? 0 : this.getUint32(block + pending.next, true);
			if (last) this.state.pending_tail = 0;

			// The committed version still lists this block
			this.freed.push([block, this.blockSize]);
		}
	}

	/** Records everything freed by this transaction */
	protected flush(txn: bigint): void {
		for (;;) {
			for (const block of this.recycled) this.freed.push([block, this.blockSize]);
			this.recycled = [];
			if (!this.freed.length) return;

			const batch = this.freed;
			this.freed = [];
			for (const [offset, size] of batch) this.appendPending(txn, offset, size);
		}
	}

	protected appendPending(txn: bigint, offset: number, size: number): void {
		let tail = this.state.pending_tail;

		if (!tail || this.getBigUint64(tail + pending.txn, true) !== txn || this.getUint32(tail + pending.count, true) >= this.pendingCapacity) {
			const block = this.allocBlock();
			this.setUint32(block + pending.next, 0, true);
			this.setUint32(block + pending.count, 0, true);
			this.setBigUint64(block + pending.txn, txn, true);

			// Committed versions stop at their own tail, so linking from it in place is safe
			if (tail) this.setUint32(tail + pending.next, block, true);
			else this.state.pending_head = block;

			this.state.pending_tail = tail = block;
		}

		const count = this.getUint32(tail + pending.count, true);
		const entry = tail + pending.entries + count * sizeof(Extent);
		this.setUint32(entry + pending.offset, offset, true);
		this.setUint32(entry + pending.size, size, true);
		this.setUint32(tail + pending.count, count + 1, true);
		this.state.pending_bytes += size;
	}

	/* Allocation */

	/** Minimum blocks available for tree nodes, enough to copy and split a path in both free trees */
	protected lowWater(): number {
		return 4 * (Math.max(this.byOffset.height, this.bySize.height) + 1) * this.reserveScale;
	}

	/** Blocks that can be allocated without changing the free trees */
	protected availableBlocks(): number {
		return this.state.reserve_size / this.blockSize + this.recycled.length;
	}

	protected ensureReserve(): void {
		if (this.inAllocator) return;
		const low = this.lowWater();
		if (this.availableBlocks() >= low) return;

		this.inAllocator = true;
		try {
			const total = Math.floor(this.byteLength / this.blockSize);
			for (let blocks = Math.min(low * 2, total); blocks >= 1 && this.availableBlocks() < low;) {
				try {
					this.addToReserve(this.takeExtent(blocks * this.blockSize), blocks * this.blockSize);
				} catch (e) {
					if (e === reserveExhausted || (e as { code?: string }).code != 'ENOSPC') throw e;
					blocks >>= 1;
				}
			}
		} finally {
			this.inAllocator = false;
		}
	}

	/** Keeps the largest contiguous run as the reserve and recycles the other blocks */
	protected addToReserve(offset: number, size: number): void {
		const { reserve_offset, reserve_size } = this.state;

		if (reserve_size && reserve_offset + reserve_size == offset) {
			this.state.reserve_size += size;
			return;
		}

		const [keep, keepSize, recycle, recycleSize] =
			size > reserve_size ? [offset, size, reserve_offset, reserve_size] : [reserve_offset, reserve_size, offset, size];

		for (let block = recycle; block < recycle + recycleSize; block += this.blockSize) this.recycled.push(block);

		this.state.reserve_offset = keep;
		this.state.reserve_size = keepSize;
	}

	protected allocBlock(): number {
		let block = this.recycled.pop();

		if (block === undefined) {
			this.ensureReserve();

			if (this.state.reserve_size < this.blockSize) {
				if (this.inAllocator) throw reserveExhausted;
				throw err(withErrno('ENOSPC', 'sbfs: no space for metadata'));
			}

			block = this.state.reserve_offset;
			this.state.reserve_offset += this.blockSize;
			this.state.reserve_size -= this.blockSize;
		}

		this.fresh.add(block);
		return block;
	}

	protected freeBlock(block: number): void {
		if (this.fresh.delete(block)) this.recycled.push(block);
		else this.freed.push([block, this.blockSize]);
	}

	/** Removes a best-fit extent from the free trees */
	protected takeExtent(size: number): number {
		const found = this.bySize.ceiling(sizeKey(size, 0));
		if (!found) throw withErrno('ENOSPC', 'sbfs: no free extent is large enough');

		const [key] = found;
		const length = Number(key >> 32n),
			offset = Number(key & 0xffffffffn);

		this.bySize.delete(key);
		this.byOffset.delete(offset);

		if (length > size) {
			this.byOffset.set(offset + size, length - size);
			this.bySize.set(sizeKey(length - size, offset + size), undefined);
		}

		this.state.free_bytes -= size;
		return offset;
	}

	/** Allocates space for data, but only while there are enough blocks for metadata, so deleting never runs out of space */
	protected allocExtent(size: number): number {
		this.ensureReserve();

		if (this.availableBlocks() < this.lowWater()) throw withErrno('ENOSPC', 'sbfs: no space left');

		this.inAllocator = true;
		try {
			return this.takeExtent(size);
		} finally {
			this.inAllocator = false;
		}
	}

	/** Returns an extent to the free trees, merging it with adjacent free extents */
	protected freeExtent(offset: number, size: number): void {
		if (!size) return;

		this.ensureReserve();
		this.inAllocator = true;
		try {
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
			this.state.free_bytes += size;
		} finally {
			this.inAllocator = false;
		}
	}

	/* Store */

	public keys(): number[] {
		return this.snapshot(index => Array.from(index.keys(), Number));
	}

	public get(id: number): Uint8Array | undefined {
		return this.snapshot(index => {
			const extent = index.get(BigInt(id));
			if (!extent) return;
			const start = this.byteOffset + extent.offset;
			return new Uint8Array(this.buffer.slice(start, start + extent.size));
		});
	}

	public set(id: number, data: Uint8Array): void {
		if (id === 0 && data.length < sizeof(Inode)) throw alert(withErrno('EIO', `sbfs: tried to set ${data.length} bytes for id 0!`));

		const key = BigInt(id);

		this.transact(() => {
			const offset = data.length ? this.allocExtent(data.length) : 0;
			this.bytes.set(data, offset);

			const old = this.index.get(key);
			this.index.set(key, Object.assign(new Extent(), { offset, size: data.length }));
			if (old?.size) this.freed.push([old.offset, old.size]);
		});
	}

	public delete(id: number): void {
		const key = BigInt(id);

		this.transact(() => {
			const old = this.index.get(key);
			if (!old) return;
			this.index.delete(key);
			if (old.size) this.freed.push([old.offset, old.size]);
		});
	}

	public allocId(): [ino: number, data: number] {
		const id = Atomics.add(this.nextId, 0, 2n);
		if (id + 1n > max_id) throw err(withErrno('ENOSPC', 'sbfs: no IDs available'));
		return [Number(id), Number(id + 1n)];
	}

	public usage(): UsageInfo {
		const meta = this.metas[Number(Atomics.load(this.txn, 0) & 1n)];
		return {
			totalSpace: Number(this.superblock.total_bytes),
			freeSpace: meta.free_bytes + meta.reserve_size + meta.pending_bytes,
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
