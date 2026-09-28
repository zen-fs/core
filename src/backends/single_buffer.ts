// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { alert, crit, debug, err, warn } from 'kerium/log';
import type { ArrayOf } from 'memium';
import { array, offsetof, sizeof } from 'memium';
import { $from, field, struct, types as t } from 'memium/decorators';
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

const hex = (value: number | bigint): string => '0x' + value.toString(16).padStart(8, '0');

// eslint-disable-next-line @typescript-eslint/unbound-method
const { format } = new Intl.NumberFormat('en-US', {
	notation: 'compact',
	maximumFractionDigits: 2,
	unit: 'byte',
	unitDisplay: 'narrow',
});

@struct.packed()
class MetadataEntry extends $from(BufferView) {
	static name = 'MetadataEntry';

	/** Inode or data ID */
	@t.uint32 accessor id!: number;

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected accessor offset_!: number;

	/** Offset into the buffer the data is stored at. */
	@t.uint32 accessor offset!: number;

	/** The size of the data */
	@t.uint32 accessor size!: number;

	public toString() {
		return `<MetadataEntry @ ${hex(this.byteOffset)}>`;
	}
}

/**
 * A node in the free list, stored at the start of each free region.
 * Regions are kept aligned to `allocation_alignment`, so a region is always large enough to hold this header.
 */
@struct.packed()
class FreeExtent extends $from(BufferView) {
	static name = 'FreeExtent';

	/** Size of the free region, including this header. */
	@t.uint32 accessor size!: number;

	/** Offset of the next free region, or 0 for the end of the list. */
	@t.uint32 accessor next!: number;
}

/** Allocations are rounded up to this many bytes so every region can hold a `FreeExtent` when freed. */
const allocation_alignment = sizeof(FreeExtent);

function alignUp(value: number): number {
	return Math.ceil(value / allocation_alignment) * allocation_alignment;
}

/**
 * Number of entries per block of metadata
 */
const entries_per_block = 255;

/**
 * Number of times to attempt to acquire a lock before giving up.
 */
const max_lock_attempts = 5;

/**
 * A block of metadata for a single-buffer file system.
 * This metadata maps IDs (for inodes and data) to actual offsets in the buffer.
 * This is done since IDs are not guaranteed to be sequential.
 */
@struct.packed()
export class MetadataBlock extends $from.typed(Int32Array)<ArrayBufferLike> {
	static name = 'MetadataBlock';

	declare readonly ['constructor']: typeof MetadataBlock;

	private static readonly lockIndex: number;

	/**
	 * The crc32c checksum for the metadata block.
	 * @privateRemarks Keep this first!
	 */
	@t.uint32 accessor checksum!: number;

	/** The (last) time this metadata block was updated */
	@t.uint64 accessor timestamp: bigint = BigInt(Date.now());

	/** Offset to the previous metadata block */
	@t.uint32 accessor previous_offset!: number;

	protected _previous?: MetadataBlock;

	public get previous(): MetadataBlock | undefined {
		if (!this.previous_offset) return;
		this._previous ??= new MetadataBlock(this.buffer, this.previous_offset);
		return this._previous;
	}

	/** Metadata entries. */
	@field(array(MetadataEntry, entries_per_block)) accessor items!: ArrayOf<MetadataEntry>;

	public toString(long: boolean = false): string {
		if (!long) return `<MetadataBlock @ ${hex(this.byteOffset)}>`;

		let text = [
			`---- Metadata block at ${hex(this.byteOffset)} ----`,
			`Checksum: ${hex(this.checksum)}`,
			`Last updated: ${new Date(Number(this.timestamp)).toLocaleString()}`,
			`Previous block: ${hex(this.previous_offset)}`,
			'Entries:',
		].join('\n');

		for (const entry of this.items) {
			if (!entry.offset) continue;
			text += `\n\t${hex(entry.id)}: ${format(entry.size).padStart(5)} at ${hex(entry.offset)}`;
		}

		return text;
	}

	/**
	 * If non-zero, this block is locked for writing.
	 * Note a int32 is used for `Atomics.wait`
	 */
	@t.int32 accessor locked!: number;

	/**
	 * Wait for the block to be unlocked.
	 */
	public waitUnlocked(depth: number = 0): void {
		if (depth > max_lock_attempts)
			throw crit(withErrno('EBUSY', `sbfs: exceeded max attempts waiting for metadata block at ${hex(this.byteOffset)} to be unlocked`));

		if (!Atomics.load(this, MetadataBlock.lockIndex)) return;
		switch (Atomics.wait(this, MetadataBlock.lockIndex, 1)) {
			case 'ok':
				break;
			case 'not-equal':
				depth++;
				err(`sbfs: waiting for metadata block at ${hex(this.byteOffset)} to be unlocked (${depth}/${max_lock_attempts})`);
				return this.waitUnlocked(depth);
			case 'timed-out':
				throw crit(withErrno('EBUSY', `sbfs: timed out waiting for metadata block at ${hex(this.byteOffset)} to be unlocked`));
		}
	}

	public lock(): SBLock {
		this.waitUnlocked();

		Atomics.store(this, MetadataBlock.lockIndex, 1);

		const release = () => {
			Atomics.store(this, MetadataBlock.lockIndex, 0);
			Atomics.notify(this, MetadataBlock.lockIndex, 1);
		};

		release[Symbol.dispose] = release;

		return release;
	}
}

// workaround for https://github.com/microsoft/TypeScript/issues/61862
Object.assign(MetadataBlock, { lockIndex: offsetof(MetadataBlock, 'locked') / Int32Array.BYTES_PER_ELEMENT });

const sb_magic = 0x62732e7a; // 'z.sb'

/** On-disk format version. v2 adds the free list (`free_offset`, `free_bytes`) for space reuse. */
const sb_version = 2;

/**
 * Shortcut for minor perf. bump
 * @internal
 */
const kUsedBytes = 2;

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
			const md = new MetadataBlock(this.buffer, sizeof(SuperBlock));
			Object.assign(this, {
				metadata: md,
				metadata_offset: md.byteOffset,
				used_bytes: BigInt(sizeof(SuperBlock) + sizeof(MetadataBlock)),
				total_bytes: BigInt(this.buffer.byteLength),
				magic: sb_magic,
				version: sb_version,
				inode_format: _inode_version,
				metadata_block_size: sizeof(MetadataBlock),
				free_offset: 0,
				free_bytes: 0n,
				uuid: encodeUUID(crypto.randomUUID()),
			});
			_update(this);
			_update(md);
			return;
		}

		if (this.version != sb_version)
			throw crit(withErrno('EIO', `sbfs: on-disk format version ${this.version} is not supported (expected ${sb_version})`));

		if (this.checksum !== checksum(this)) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for super block'));

		this.metadata = new MetadataBlock(this.buffer, this.metadata_offset);

		if (this.metadata.checksum !== checksum(this.metadata))
			throw crit(
				withErrno(
					'EIO',
					`sbfs: checksum mismatch for metadata block (saved ${hex(this.metadata.checksum)}, computed ${hex(checksum(this.metadata))})`
				)
			);

		if (this.inode_format != _inode_version) throw crit(withErrno('EIO', 'sbfs: inode format mismatch'));

		if (this.metadata_block_size != sizeof(MetadataBlock)) throw crit(withErrno('EIO', 'sbfs: metadata block size mismatch'));
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

	/**
	 * The size in bytes of a metadata block.
	 * Not currently configurable.
	 */
	@t.uint32 accessor metadata_block_size!: number;

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected accessor metadata_offset_!: number;
	/** Offset of the current metadata block */
	@t.uint32 accessor metadata_offset!: number;

	public metadata!: MetadataBlock;

	/** An optional label for the file system */
	@t.char(64) accessor label!: Uint8Array;

	/** Offset of the first free region, or 0 if the free list is empty. */
	@t.uint32 accessor free_offset!: number;

	/** Total bytes held in the free list. */
	@t.uint64 accessor free_bytes!: bigint;

	/** Padded to 256 bytes */
	@t.char(116) accessor _padding!: Uint8Array;

	/**
	 * If non-zero, the free list is locked for writing.
	 * Kept last and excluded from the checksum since it is toggled without `_update`.
	 */
	@t.int32 accessor free_lock!: number;

	/**
	 * Rotate out the current metadata block.
	 * Allocates a new metadata block, moves the current one to backup,
	 * and updates used_bytes accordingly.
	 * @returns the new metadata block
	 */
	public rotateMetadata(): MetadataBlock {
		const alignment = BigInt(Int32Array.BYTES_PER_ELEMENT),
			blockSize = BigInt(sizeof(MetadataBlock));
		let used = Atomics.load(this, kUsedBytes),
			offset: bigint;

		// Padding and block space must be reserved together because other writers can advance used_bytes at any time.
		for (;;) {
			const padding = (alignment - (used % alignment)) % alignment;
			offset = used + padding;
			const next = offset + blockSize;
			if (next > this.total_bytes) throw err(withErrno('ENOSPC', 'sbfs: not enough space for a new metadata block'));
			const observed = Atomics.compareExchange(this, kUsedBytes, used, next);
			if (observed === used) break;
			used = observed;
		}

		const metadata = new MetadataBlock(this.buffer, Number(offset));

		const offsets = new Uint32Array(this.buffer, this.byteOffset, sizeof(SuperBlock) / Uint32Array.BYTES_PER_ELEMENT);
		let previous = Atomics.load(offsets, kMetadataOffset);

		for (;;) {
			metadata.previous_offset = previous;
			_update(metadata);
			const observed = Atomics.compareExchange(offsets, kMetadataOffset, previous, metadata.byteOffset);
			if (observed === previous) break;
			previous = observed;
		}

		this.metadata = metadata;
		_update(this);

		debug(`sbfs: rotated metadata block at ${hex(metadata.previous_offset)} with new block at ${hex(metadata.byteOffset)}`);

		return metadata;
	}

	/**
	 * Checks to see if `length` bytes are unused, starting at `offset`.
	 * @internal Not for external use!
	 */
	public isUnused(offset: number, length: number): boolean {
		if (!length) return true;

		if (offset + length > this.total_bytes || offset < sizeof(SuperBlock)) return false;

		for (let block: MetadataBlock | undefined = this.metadata; block; block = block.previous) {
			if (offset < block.byteOffset + sizeof(MetadataBlock) && offset + length > block.byteOffset) return false;

			for (const entry of block.items) {
				if (!entry.offset) continue;

				if (
					(offset >= entry.offset && offset < entry.offset + entry.size)
					|| (offset + length > entry.offset && offset + length <= entry.offset + entry.size)
					|| (offset <= entry.offset && offset + length >= entry.offset + entry.size)
				) {
					return false;
				}
			}
		}

		return true;
	}

	protected _lockView?: Int32Array;

	private get lockView(): Int32Array {
		return (this._lockView ??= new Int32Array(this.buffer, this.byteOffset + freeLockOffset, 1));
	}

	/** Acquire the free-list lock, serializing allocation and freeing across realms. */
	protected lockFreeList(): SBLock {
		const view = this.lockView;
		for (let attempts = 0; Atomics.compareExchange(view, 0, 0, 1) !== 0; attempts++) {
			if (attempts > max_lock_attempts) throw crit(withErrno('EBUSY', 'sbfs: exceeded max attempts waiting for the free list lock'));
			Atomics.wait(view, 0, 1);
		}

		const release = () => {
			Atomics.store(view, 0, 0);
			Atomics.notify(view, 0, 1);
		};
		release[Symbol.dispose] = release;
		return release;
	}

	private relink(previous: number, target: number): void {
		if (previous) new FreeExtent(this.buffer, previous).next = target;
		else this.free_offset = target;
	}

	/**
	 * Reserve `length` bytes, reusing a freed region when one fits and otherwise growing into unallocated space.
	 * @returns the offset of the reserved region
	 */
	public allocate(length: number): number {
		const size = Math.max(alignUp(length), allocation_alignment);
		using _lock = this.lockFreeList();

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
				_update(this);
				return offset;
			}

			previous = offset;
			offset = next;
		}

		for (;;) {
			const used = Atomics.load(this, kUsedBytes);
			const padding = BigInt((allocation_alignment - (Number(used) % allocation_alignment)) % allocation_alignment);
			const offset = used + padding;
			if (offset + BigInt(size) > this.total_bytes) throw err(withErrno('ENOSPC', 'sbfs: no space left on device'));
			if (Atomics.compareExchange(this, kUsedBytes, used, offset + BigInt(size)) !== used) continue;
			_update(this);
			return Number(offset);
		}
	}

	/** Return a previously reserved region to the free list, coalescing with adjacent free regions. */
	public free(offset: number, length: number): void {
		const size = Math.max(alignUp(length), allocation_alignment);
		using _lock = this.lockFreeList();

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
				_update(this);
				return;
			}
		}

		const extent = new FreeExtent(this.buffer, offset);
		extent.size = end - offset;
		extent.next = next;
		this.relink(previous, offset);
		this.free_bytes += BigInt(size);
		_update(this);
	}
}

/**
 * Index of `SuperBlock.metadata_offset` in a `Uint32Array` view of the super block.
 * @internal
 */
const kMetadataOffset = offsetof(SuperBlock, 'metadata_offset') / Uint32Array.BYTES_PER_ELEMENT;

/** Byte offset of `SuperBlock.free_lock`, used for the free-list lock's `Int32Array` view. */
const freeLockOffset = offsetof(SuperBlock, 'free_lock');

/**
 * Compute the checksum for a super block or metadata block.
 * Note we don't include the checksum when computing a new one.
 */
function checksum(value: SuperBlock | MetadataBlock): number {
	let length = sizeof(value) - 4;
	if (value instanceof MetadataBlock || value instanceof SuperBlock) length -= Int32Array.BYTES_PER_ELEMENT;
	return crc32c(new Uint8Array(value.buffer, value.byteOffset + 4, length));
}

/**
 * Update a block's checksum and timestamp.
 * @internal @hidden
 */
function _update(value: SuperBlock | MetadataBlock): void {
	if (value instanceof MetadataBlock) value.timestamp = BigInt(Date.now());
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

	/**
	 * @internal @hidden
	 */
	protected readonly _view: DataView;

	protected readonly _u8: Uint8Array;

	public constructor(...args: ConstructorParameters<typeof BufferView>) {
		super(...args);

		if (this.byteLength < sizeof(SuperBlock) + sizeof(MetadataBlock))
			throw crit(withErrno('EINVAL', 'sbfs: Buffer is too small for a file system'));

		this._view = new DataView(this.buffer, this.byteOffset, this.byteLength);
		this._u8 = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
		this.superblock = new SuperBlock(this.buffer, this.byteOffset);
	}

	public *keys(): Iterable<number> {
		const keys = new Set<number>();
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			block.waitUnlocked();
			for (const entry of block.items) {
				if (!entry.offset || keys.has(entry.id)) continue;
				keys.add(entry.id);
				yield entry.id;
			}
		}
	}

	public get(id: number): Uint8Array | undefined {
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			block.waitUnlocked();
			for (const entry of block.items) {
				if (!entry.offset || entry.id != id) continue;
				const off = this.byteOffset + entry.offset;
				return new Uint8Array(this.buffer.slice(off, off + entry.size));
			}
		}
	}

	public set(id: number, data: Uint8Array): void {
		if (id === 0 && data.length < sizeof(Inode)) throw alert(withErrno('EIO', `sbfs: tried to set ${data.length} bytes for id 0!`));

		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			block.waitUnlocked();
			for (const entry of block.items) {
				if (!entry.offset || entry.id != id) continue;

				using _lock = block.lock();

				const oldRegion = Math.max(alignUp(entry.size), allocation_alignment);
				const newRegion = Math.max(alignUp(data.length), allocation_alignment);

				if (newRegion === oldRegion) {
					this._u8.set(data, entry.offset);
					entry.size = data.length;
					_update(block);
					return;
				}

				if (newRegion < oldRegion) {
					this._u8.set(data, entry.offset);
					entry.size = data.length;
					_update(block);
					this.superblock.free(entry.offset + newRegion, oldRegion - newRegion);
					return;
				}

				const grown = this.superblock.allocate(data.length);
				const previousOffset = entry.offset;
				this._u8.set(data, grown);
				entry.offset = grown;
				entry.size = data.length;
				_update(block);
				this.superblock.free(previousOffset, oldRegion);
				return;
			}
		}

		let entry = Array.from(this.superblock.metadata.items).find(e => !e.offset);

		if (!entry) {
			this.superblock.rotateMetadata();
			entry = this.superblock.metadata.items[0];
		}

		using _lock = this.superblock.metadata.lock();

		const offset = this.superblock.allocate(data.length);

		entry.id = id;
		entry.offset = offset;
		entry.size = data.length;

		this._u8.set(data, offset);

		_update(this.superblock.metadata);
	}

	public delete(id: number): void {
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			block.waitUnlocked();
			for (const entry of block.items) {
				if (entry.id != id) continue;

				using _lock = block.lock();

				const offset = entry.offset;
				const size = Math.max(alignUp(entry.size), allocation_alignment);
				entry.offset = 0;
				entry.size = 0;
				entry.id = 0;
				_update(block);
				if (offset) this.superblock.free(offset, size);
				return;
			}
		}
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
