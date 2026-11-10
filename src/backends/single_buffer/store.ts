// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { crit, debug, err } from 'kerium/log';
import { offsetof, sizeof } from 'memium';
import { BPlusTree, type BPlusTreeStorage } from 'memium/bplustree';
import { EpochTable, Mutex } from 'memium/locks';
import { types as primitive } from 'memium/primitives';
import type { UUID } from 'node:crypto';
import { _throw } from 'utilium';
import { decodeUUID, encodeUUID } from 'utilium/string';
import { id_max } from '../../constants.js';
import type { UsageInfo } from '../../internal/filesystem.js';
import { _inode_version } from '../../internal/inode.js';
import type { StoreFS } from '../store/fs.js';
import type { SyncMapStore } from '../store/map.js';
import { SyncTransaction, type Store } from '../store/store.js';
import { Commit, DataExtent, max_size, sb_magic, SpareHeader, State, SuperBlock } from './data.js';
import { WriteTransaction, sparesExhausted } from './transaction.js';

const default_epoch_slots = 64;
const default_block_size = 4096;

/** Most spare blocks for tree nodes when a file system is created */
const initial_spares = 16;

const defaultStateSize = sizeof(State) + EpochTable.sizeOf(default_epoch_slots);

/**
 * A transaction that reads one version of the file system, then applies its changes together when committed.
 * Committing throws EAGAIN if another transaction changed something this one read.
 * @category Stores and Transactions
 */
export class SingleBufferTransaction extends SyncTransaction<SingleBufferStore> {
	protected readonly snapshot: Snapshot;

	protected readonly index: BPlusTree<bigint, DataExtent>;

	/** Where the IDs read were stored, which must be unchanged when committing */
	protected readonly reads = new Map<bigint, [offset: number, size: number] | undefined>();

	/** Whether the set of IDs was read */
	protected readKeys = false;

	/** Changes in order, which remove an ID when there is no data */
	protected changes: [id: bigint, data?: Uint8Array, offset?: number][] = [];

	public constructor(store: SingleBufferStore) {
		super(store);
		this.snapshot = store.snapshot();
		this.index = new BPlusTree<bigint, DataExtent>(
			store.readOnly,
			{ key: primitive.uint64, value: DataExtent },
			this.snapshot.index_root,
			this.snapshot.index_count,
		);
	}

	protected read(id: bigint, offset: number, end?: number): Uint8Array | undefined {
		const extent = this.index.get(id);
		if (!this.reads.has(id)) this.reads.set(id, extent && [extent.offset, extent.size]);
		return this.store.copy(extent, offset, end);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async keys(): Promise<Iterable<bigint>> {
		this.readKeys = true;
		const keys = new Set(this.index.keys());
		for (const [id, data] of this.changes) {
			if (data) keys.add(id);
			else keys.delete(id);
		}
		return keys;
	}

	public getSync(id: bigint, offset: number = 0, end?: number): Uint8Array | undefined {
		const changes = this.changes.filter(([changed]) => changed === id);
		if (!changes.length) return this.read(id, offset, end);

		const replaced = changes.findLastIndex(([, , at]) => at === undefined);
		let data = replaced == -1 ? this.read(id, 0) : changes[replaced][1];
		for (const [, chunk, at] of changes.slice(replaced + 1)) {
			const merged = new Uint8Array(Math.max(data?.length ?? 0, at! + chunk!.length));
			if (data) merged.set(data);
			merged.set(chunk!, at);
			data = merged;
		}
		return data?.slice(offset, end);
	}

	public setSync(id: bigint, data: Uint8Array, offset?: number): void {
		this.changes.push([id, data, offset]);
	}

	public removeSync(id: bigint): void {
		this.changes.push([id]);
	}

	/** Whether anything this transaction read was changed after its snapshot */
	protected conflicts(tx: WriteTransaction): boolean {
		if (tx.generation == this.snapshot.generation + 1n) return false;
		if (this.readKeys) return true;
		for (const [id, read] of this.reads) {
			const extent = tx.index.get(id);
			if (extent?.offset !== read?.[0] || extent?.size !== read?.[1]) return true;
		}
		return false;
	}

	public commitSync(): void {
		using _ = this.snapshot;
		if (!this.changes.length) return;

		this.store.write(tx => {
			if (this.conflicts(tx)) throw withErrno('EAGAIN', 'sbfs: another transaction changed data read by this one');
			for (const [id, data, offset] of this.changes) {
				if (data) tx.set(id, data, offset);
				else tx.delete(id);
			}
		});
		this.changes = [];
	}

	public abortSync(): void {
		this.changes = [];
		this.snapshot[Symbol.dispose]();
	}
}

export interface SingleBufferStoreOptions {
	/** Erases the buffer and creates a new file system */
	format?: boolean;
}

/**
 * A store for the single-buffer format.
 *
 * Every change is a transaction that copies what it modifies.
 * Readers never block, and an interrupted writer does not change the file system.
 * @category Stores and Transactions
 */
export class SingleBufferStore extends DataView<ArrayBufferLike> implements SyncMapStore {
	public readonly flags = ['partial', 'atomic'] as const;
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
	protected readonly nextId: BigUint64Array;
	protected readonly commits: [Commit, Commit];

	/** @internal */
	public readonly readOnly: BPlusTreeStorage;

	/** The index of the version being read */
	protected readonly index: BPlusTree<bigint, DataExtent>;

	/** Pins the oldest version read by this thread's unfinished reads */
	protected pinned?: { release: () => void; users: number };

	/** Opens a file system, or creates one if `format` is set */
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

		const { format } = options;
		let { superblock } = this;
		const gaps: [start: number, end: number][] = [];
		let spares = 0,
			spareBlocks = 0;

		if (!format) this.superblock.validate(this.byteLength);
		else {
			if (this.byteLength > max_size) throw crit(withErrno('EINVAL', 'sbfs: buffers larger than 4 GiB are not supported'));

			gaps.push([sizeof(SuperBlock), this.byteLength]);

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
				uuid: encodeUUID(crypto.randomUUID()),
				state_offset: take(defaultStateSize, 8),
			});

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
		this.nextId = new BigUint64Array(this.buffer, state + offsetof(State, 'next_id'), 1);
		this.commits = [new Commit(this.buffer, commits), new Commit(this.buffer, commits + sizeof(Commit))];
		this.epochs = new EpochTable(this.buffer, state + sizeof(State), epoch_slots);

		this.readOnly = {
			buffer: this.buffer,
			pageSize: this.blockSize,
			offsetOf: block => this.byteOffset + block,
			alloc: () => _throw(withErrno('EROFS', 'sbfs: snapshots are read-only')),
			free: () => _throw(withErrno('EROFS', 'sbfs: snapshots are read-only')),
		};
		this.index = new BPlusTree<bigint, DataExtent>(this.readOnly, { key: primitive.uint64, value: DataExtent });

		if (!format) {
			if (!this.withCurrentCommit((commit, generation) => commit.isValid(generation)))
				throw crit(withErrno('EIO', 'sbfs: the current commit is corrupt'));
			return;
		}

		this.bytes.fill(0, state_offset, state_offset + defaultStateSize);
		Atomics.store(this.nextId, 0, 2n);
		this.setUint32(spares + offsetof(SpareHeader, 'next'), 0, true);
		for (let i = 1; i < spareBlocks; i++) this.setUint32(spares + sizeof(SpareHeader) + (i - 1) * 4, spares + i * block_size, true);
		Object.assign(this.commits[0], { spare_head: spares, spare_count: spareBlocks - 1, spare_total: spareBlocks - 1 });
		this.commits[0].update();

		this.write(tx => {
			for (const [start, end] of gaps) tx.freeExtent(start, end - start);
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

	/**
	 * Pins the current version, which stays readable until the snapshot is disposed.
	 * Snapshots in the same thread share one pin of the oldest version.
	 * @internal
	 */
	public snapshot(): Snapshot {
		if (!this.pinned) {
			for (;;) {
				const generation = Atomics.load(this.generation, 0);
				const release = this.epochs.pin(generation);
				if (Atomics.load(this.generation, 0) === generation) {
					this.pinned = { release, users: 0 };
					break;
				}
				release();
			}
		}

		const pinned = this.pinned;
		pinned.users++;
		let disposed = false;

		return {
			...this.withCurrentCommit((commit, generation) => ({ generation, index_root: commit.index_root, index_count: commit.index_count })),
			[Symbol.dispose]: () => {
				if (disposed) return;
				disposed = true;
				if (--pinned.users) return;
				pinned.release();
				this.pinned = undefined;
			},
		};
	}

	/** Runs `read` against the current version */
	protected read<T>(read: (index: BPlusTree<bigint, DataExtent>) => T): T {
		using snapshot = this.snapshot();
		this.index.reset(snapshot.index_root, snapshot.index_count);
		return read(this.index);
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

	public keys(): bigint[] {
		return this.read(index => Array.from(index.keys()));
	}

	public get(id: bigint, offset: number = 0, end?: number): Uint8Array | undefined {
		return this.read(index => this.copy(index.get(id), offset, end));
	}

	/**
	 * Copies the bytes of an extent from `offset` to `end`
	 * @internal
	 */
	public copy(extent: DataExtent | undefined, offset: number, end?: number): Uint8Array | undefined {
		if (!extent) return;
		const start = this.byteOffset + extent.offset;
		return new Uint8Array(this.buffer.slice(start + Math.min(offset, extent.size), start + Math.min(end ?? extent.size, extent.size)));
	}

	public set(id: bigint, data: Uint8Array, offset?: number): void {
		this.write(tx => tx.set(id, data, offset));
	}

	public delete(id: bigint): void {
		this.write(tx => tx.delete(id));
	}

	public allocId(): [ino: bigint, data: bigint] {
		const id = Atomics.add(this.nextId, 0, 2n);
		if (id + 1n > id_max) throw err(withErrno('ENOSPC', 'sbfs: no IDs available'));
		return [id, id + 1n];
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

	public transaction(): SingleBufferTransaction {
		return new SingleBufferTransaction(this);
	}
}

/** A pinned version of the file system */
export interface Snapshot extends Disposable {
	generation: bigint;
	index_root: number;
	index_count: number;
}
