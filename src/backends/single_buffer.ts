// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { alert, crit, err, warn } from 'kerium/log';
import { offsetof, sizeof } from 'memium';
import { $from, struct, types as t } from 'memium/decorators';
import type { UUID } from 'node:crypto';
import { BufferView } from 'utilium/buffer';
import { crc32c } from 'utilium/checksum';
import { decodeUUID, encodeUUID } from 'utilium/string';
import type { UsageInfo } from '../internal/filesystem.js';
import { _inode_version, Inode } from '../internal/inode.js';
import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { SyncMapTransaction, type SyncMapStore } from './store/map.js';
import type { Store } from './store/store.js';

type SBLock = Disposable & (() => void);

@struct.packed()
class FreeExtent extends $from(BufferView) {
	static name = 'FreeExtent';

	@t.uint32 accessor size!: number;

	@t.uint32 accessor next!: number;
}

const allocation_alignment = sizeof(FreeExtent);

function alignUp(value: number): number {
	return Math.ceil(value / allocation_alignment) * allocation_alignment;
}

@struct.packed()
class HashSlot extends $from(BufferView) {
	static name = 'HashSlot';

	@t.uint32 accessor id!: number;

	@t.uint32 accessor offset!: number;

	@t.uint32 accessor size!: number;
}

const tombstone = 0xffffffff;

const initial_table_capacity = 64;

const load_numerator = 3;
const load_denominator = 4;

/**
 * Number of times to attempt to acquire a lock before giving up.
 */
const max_lock_attempts = 5;

function hashId(id: number, capacity: number): number {
	return (Math.imul(id, 0x9e3779b1) >>> 0) & (capacity - 1);
}

const sb_magic = 0x62732e7a; // 'z.sb'

const sb_version = 2;

/**
 * The super block structure for a single-buffer file system
 */
@struct.packed()
export class SuperBlock extends $from.typed(BigUint64Array)<ArrayBufferLike> {
	static name = 'SuperBlock';

	declare readonly ['constructor']: typeof SuperBlock;

	public constructor(...args: ConstructorParameters<typeof BigUint64Array<ArrayBufferLike>>) {
		super(...args);

		if (this.magic != sb_magic) {
			warn('sbfs: Invalid magic value, assuming this is a fresh super block');

			const tableOffset = sizeof(SuperBlock);
			const tableBytes = initial_table_capacity * sizeof(HashSlot);

			Object.assign(this, {
				used_bytes: BigInt(tableOffset + tableBytes),
				total_bytes: BigInt(this.buffer.byteLength),
				magic: sb_magic,
				version: sb_version,
				inode_format: _inode_version,
				free_offset: 0,
				free_bytes: 0n,
				table_offset: tableOffset,
				table_capacity: initial_table_capacity,
				table_count: 0,
				table_tombstones: 0,
				uuid: encodeUUID(crypto.randomUUID()),
			});

			new Uint8Array(this.buffer, this.byteOffset + tableOffset, tableBytes).fill(0);
			_update(this);
			return;
		}

		if (this.version != sb_version)
			throw crit(withErrno('EIO', `sbfs: on-disk format version ${this.version} is not supported (expected ${sb_version})`));

		if (this.checksum !== checksum(this)) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for super block'));

		if (this.inode_format != _inode_version) throw crit(withErrno('EIO', 'sbfs: inode format mismatch'));
	}

	/**
	 * The crc32c checksum for the super block.
	 * @privateRemarks Keep this first!
	 */
	@t.uint32 accessor checksum!: number;

	/** Signature for the superblock. */
	@t.uint32 accessor magic!: number;

	/** The version of the on-disk format */
	@t.uint16 accessor version!: number;

	/** Which format of `Inode` is used */
	@t.uint16 accessor inode_format!: number;

	/** Flags for the file system. Currently unused */
	@t.uint32 accessor flags!: number;

	/** The number of used bytes, including the super block and metadata */
	@t.uint64 accessor used_bytes!: bigint;

	/** The total size of the entire file system, including the super block and metadata */
	@t.uint64 accessor total_bytes!: bigint;

	/** A UUID for this file system */
	@t.uint8(16) accessor uuid!: Uint8Array;

	@t.uint64 accessor free_bytes!: bigint;

	@t.uint32 accessor free_offset!: number;

	@t.uint32 accessor table_offset!: number;

	@t.uint32 accessor table_capacity!: number;

	@t.uint32 accessor table_count!: number;

	@t.uint32 accessor table_tombstones!: number;

	/** An optional label for the file system */
	@t.char(64) accessor label!: Uint8Array;

	/** Padded to 256 bytes */
	@t.char(112) accessor _padding!: Uint8Array;

	@t.int32 accessor store_lock!: number;

	protected _lockView?: Int32Array;

	private get lockView(): Int32Array {
		return (this._lockView ??= new Int32Array(this.buffer, this.byteOffset + kStoreLock, 1));
	}

	public lock(): SBLock {
		const view = this.lockView;
		for (let attempts = 0; Atomics.compareExchange(view, 0, 0, 1) !== 0; attempts++) {
			if (attempts > max_lock_attempts) throw crit(withErrno('EBUSY', 'sbfs: exceeded max attempts waiting for the store lock'));
			Atomics.wait(view, 0, 1);
		}

		const release = () => {
			Atomics.store(view, 0, 0);
			Atomics.notify(view, 0, 1);
		};
		release[Symbol.dispose] = release;
		return release;
	}

	private slot(index: number): HashSlot {
		return new HashSlot(this.buffer, this.byteOffset + this.table_offset + index * sizeof(HashSlot));
	}

	public lookup(id: number): HashSlot | undefined {
		const capacity = this.table_capacity;
		let index = hashId(id, capacity);
		for (let probe = 0; probe < capacity; probe++, index = (index + 1) & (capacity - 1)) {
			const slot = this.slot(index);
			if (slot.offset === 0) return undefined;
			if (slot.offset === tombstone) continue;
			if (slot.id === id) return slot;
		}
	}

	public insert(id: number, offset: number, size: number): void {
		if ((this.table_count + this.table_tombstones + 1) * load_denominator >= this.table_capacity * load_numerator) this.grow();
		this._insert(id, offset, size);
	}

	private _insert(id: number, offset: number, size: number): void {
		const capacity = this.table_capacity;
		let index = hashId(id, capacity);
		let firstTombstone = -1;
		for (let probe = 0; probe < capacity; probe++, index = (index + 1) & (capacity - 1)) {
			const slot = this.slot(index);

			if (slot.offset === tombstone) {
				if (firstTombstone < 0) firstTombstone = index;
				continue;
			}

			if (slot.offset === 0) {
				const target = firstTombstone < 0 ? this.slot(index) : this.slot(firstTombstone);
				if (firstTombstone >= 0) this.table_tombstones--;
				target.id = id;
				target.offset = offset;
				target.size = size;
				this.table_count++;
				return;
			}

			if (slot.id === id) {
				slot.offset = offset;
				slot.size = size;
				return;
			}
		}

		this.grow();
		this._insert(id, offset, size);
	}

	public remove(id: number): void {
		const slot = this.lookup(id);
		if (!slot) return;
		slot.offset = tombstone;
		slot.size = 0;
		this.table_count--;
		this.table_tombstones++;
	}

	private grow(): void {
		const oldOffset = this.table_offset;
		const oldCapacity = this.table_capacity;
		const newCapacity = oldCapacity * 2;
		const newBytes = newCapacity * sizeof(HashSlot);
		const newOffset = this.allocate(newBytes);

		new Uint8Array(this.buffer, this.byteOffset + newOffset, newBytes).fill(0);
		this.table_offset = newOffset;
		this.table_capacity = newCapacity;
		this.table_count = 0;
		this.table_tombstones = 0;

		for (let i = 0; i < oldCapacity; i++) {
			const slot = new HashSlot(this.buffer, this.byteOffset + oldOffset + i * sizeof(HashSlot));
			if (slot.offset !== 0 && slot.offset !== tombstone) this._insert(slot.id, slot.offset, slot.size);
		}

		this.free(oldOffset, oldCapacity * sizeof(HashSlot));
	}

	public liveIds(): number[] {
		const ids: number[] = [];
		for (let i = 0; i < this.table_capacity; i++) {
			const slot = this.slot(i);
			if (slot.offset !== 0 && slot.offset !== tombstone) ids.push(slot.id);
		}
		return ids;
	}

	private relink(previous: number, target: number): void {
		if (previous) new FreeExtent(this.buffer, previous).next = target;
		else this.free_offset = target;
	}

	public allocate(length: number): number {
		const size = Math.max(alignUp(length), allocation_alignment);

		let previous = 0;
		for (let offset = this.free_offset; offset;) {
			const extent = new FreeExtent(this.buffer, offset);
			const next = extent.next;

			if (extent.size >= size) {
				const remainder = extent.size - size;
				if (remainder >= allocation_alignment) {
					const split = new FreeExtent(this.buffer, offset + size);
					split.size = remainder;
					split.next = next;
					this.relink(previous, offset + size);
				} else {
					this.relink(previous, next);
				}

				this.free_bytes -= BigInt(size);
				return offset;
			}

			previous = offset;
			offset = next;
		}

		const used = Number(this.used_bytes);
		const padding = (allocation_alignment - (used % allocation_alignment)) % allocation_alignment;
		const offset = used + padding;
		if (offset + size > Number(this.total_bytes)) throw err(withErrno('ENOSPC', 'sbfs: no space left on device'));
		this.used_bytes = BigInt(offset + size);
		return offset;
	}

	public free(offset: number, length: number): void {
		const size = Math.max(alignUp(length), allocation_alignment);

		let previous = 0;
		let next = this.free_offset;
		while (next && next < offset) {
			previous = next;
			next = new FreeExtent(this.buffer, next).next;
		}

		let end = offset + size;
		if (next && end === next) {
			const following = new FreeExtent(this.buffer, next);
			end += following.size;
			next = following.next;
		}

		if (previous) {
			const preceding = new FreeExtent(this.buffer, previous);
			if (previous + preceding.size === offset) {
				preceding.size = end - previous;
				preceding.next = next;
				this.free_bytes += BigInt(size);
				return;
			}
		}

		const extent = new FreeExtent(this.buffer, offset);
		extent.size = end - offset;
		extent.next = next;
		this.relink(previous, offset);
		this.free_bytes += BigInt(size);
	}
}

const kStoreLock = offsetof(SuperBlock, 'store_lock');

function checksum(value: SuperBlock): number {
	const length = sizeof(value) - 4 - Int32Array.BYTES_PER_ELEMENT;
	return crc32c(new Uint8Array(value.buffer, value.byteOffset + 4, length));
}

function _update(value: SuperBlock): void {
	value.checksum = checksum(value);
}

/**
 *
 * @category Stores and Transactions
 */
export class SingleBufferStore extends BufferView implements SyncMapStore {
	public readonly flags = [] as const;
	public readonly name = 'sbfs';
	public readonly type = 0x73626673; // 'sbfs'

	public get uuid(): UUID {
		return decodeUUID(this.superblock.uuid);
	}

	protected superblock: SuperBlock;

	protected readonly _u8: Uint8Array;

	public constructor(...args: ConstructorParameters<typeof BufferView>) {
		super(...args);

		if (this.byteLength < sizeof(SuperBlock) + initial_table_capacity * sizeof(HashSlot))
			throw crit(withErrno('EINVAL', 'sbfs: Buffer is too small for a file system'));

		this._u8 = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
		this.superblock = new SuperBlock(this.buffer, this.byteOffset);
	}

	public *keys(): Iterable<number> {
		let ids: number[];
		{
			using _lock = this.superblock.lock();
			ids = this.superblock.liveIds();
		}
		yield* ids;
	}

	public get(id: number): Uint8Array | undefined {
		using _lock = this.superblock.lock();
		const slot = this.superblock.lookup(id);
		if (!slot) return;
		const offset = this.byteOffset + slot.offset;
		return new Uint8Array(this.buffer.slice(offset, offset + slot.size));
	}

	public set(id: number, data: Uint8Array): void {
		if (id === 0 && data.length < sizeof(Inode)) throw alert(withErrno('EIO', `sbfs: tried to set ${data.length} bytes for id 0!`));

		using _lock = this.superblock.lock();

		const newRegion = Math.max(alignUp(data.length), allocation_alignment);
		const slot = this.superblock.lookup(id);

		if (slot) {
			const oldRegion = Math.max(alignUp(slot.size), allocation_alignment);

			if (newRegion === oldRegion) {
				this._u8.set(data, slot.offset);
				slot.size = data.length;
			} else if (newRegion < oldRegion) {
				this._u8.set(data, slot.offset);
				const tail = slot.offset + newRegion;
				slot.size = data.length;
				this.superblock.free(tail, oldRegion - newRegion);
			} else {
				const previousOffset = slot.offset;
				const offset = this.superblock.allocate(data.length);
				this._u8.set(data, offset);
				slot.offset = offset;
				slot.size = data.length;
				this.superblock.free(previousOffset, oldRegion);
			}
		} else {
			const offset = this.superblock.allocate(data.length);
			this._u8.set(data, offset);
			this.superblock.insert(id, offset, data.length);
		}

		_update(this.superblock);
	}

	public delete(id: number): void {
		using _lock = this.superblock.lock();

		const slot = this.superblock.lookup(id);
		if (!slot) return;

		const offset = slot.offset;
		const size = Math.max(alignUp(slot.size), allocation_alignment);
		this.superblock.remove(id);
		this.superblock.free(offset, size);

		_update(this.superblock);
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

	public usage(): UsageInfo {
		return {
			totalSpace: Number(this.superblock.total_bytes),
			freeSpace: Number(this.superblock.total_bytes - this.superblock.used_bytes + this.superblock.free_bytes),
		};
	}

	public transaction(): SyncMapTransaction {
		return new SyncMapTransaction(this);
	}
}

/**
 * Options for the `SingleBuffer` backend
 * @category Backends and Configuration
 */
export interface SingleBufferOptions {
	buffer: ArrayBufferLike | ArrayBufferView;
}

const _SingleBuffer = {
	name: 'SingleBuffer',
	options: {
		buffer: { type: 'object', required: true },
	},
	create(opt: SingleBufferOptions) {
		const fs = new StoreFS(
			ArrayBuffer.isView(opt.buffer)
				? new SingleBufferStore(opt.buffer.buffer, opt.buffer.byteOffset, opt.buffer.byteLength)
				: new SingleBufferStore(opt.buffer)
		);
		fs.checkRootSync();
		return fs;
	},
} as const satisfies Backend<StoreFS<SingleBufferStore>, SingleBufferOptions>;
type _SingleBuffer = typeof _SingleBuffer;
/**
 * A backend that uses a single buffer for storing data
 * @category Backends and Configuration
 */
export interface SingleBuffer extends _SingleBuffer {}

/**
 * A backend that uses a single buffer for storing data
 * @category Backends and Configuration
 */
export const SingleBuffer: SingleBuffer = _SingleBuffer;
