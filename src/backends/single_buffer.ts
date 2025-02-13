import { deserialize, member, offsetof, serialize, sizeof, struct, types as t } from 'utilium';
import { crc32c } from 'utilium/checksum.js';
import { Errno, ErrnoError } from '../internal/error.js';
import type { UsageInfo } from '../internal/filesystem.js';
import { _inode_version } from '../internal/inode.js';
import { crit, warn } from '../internal/log.js';
import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { SyncMapTransaction, type SyncMapStore } from './store/map.js';
import type { Store } from './store/store.js';

@struct()
class MetadataEntry {
	/** Inode or data ID */
	@t.uint32 id: number = 0;

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected offset_: number = 0;

	/** Offset into the buffer the data is stored at. */
	@t.uint32 offset: number = 0;

	/** The size of the data */
	@t.uint32 size: number = 0;
}

/**
 * Number of entries per block of metadata
 */
const entries_per_block = 255;

/**
 * A block of metadata for a single-buffer file system.
 * This metadata maps IDs (for inodes and data) to actual offsets in the buffer.
 * This is done since IDs are not guaranteed to be sequential.
 */
@struct()
class MetadataBlock {
	public constructor(
		protected readonly superblock: SuperBlock,
		public offset: number = 0
	) {
		if (!offset) return; // fresh block

		deserialize(this, superblock.store._buffer.subarray(offset, offset + sizeof(MetadataBlock)));

		if (!checksumMatches(this))
			throw crit(new ErrnoError(Errno.EIO, 'SingleBuffer: Checksum mismatch for metadata block at 0x' + offset.toString(16)));
	}

	/**
	 * The crc32c checksum for the metadata block.
	 * @privateRemarks Keep this first!
	 */
	@t.uint32 checksum: number = 0;

	/** The (last) time this metadata block was updated */
	@t.uint32 timestamp: number = Date.now();

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected previous_offset_: number = 0;
	/** Offset to the previous metadata block */
	@t.uint32 previous_offset: number = 0;

	protected _previous?: MetadataBlock;

	public get previous(): MetadataBlock | undefined {
		if (!this.previous_offset) return;
		this._previous ??= new MetadataBlock(this.superblock, this.previous_offset);
		return this._previous;
	}

	/** Metadata entries. */
	@member(MetadataEntry, entries_per_block) entries = Array.from({ length: entries_per_block }, () => new MetadataEntry());
}

const sb_magic = 0x7a2e7362; // 'z.sb'

/**
 * The super block structure for a single-buffer file system
 */
@struct()
class SuperBlock {
	public constructor(public readonly store: SingleBufferStore) {
		if (store._view.getUint32(offsetof(SuperBlock, 'magic'), true) != sb_magic) {
			warn('SingleBuffer: Invalid magic value, assuming this is a fresh super block');
			this.metadata = new MetadataBlock(this);
			this.used_bytes = BigInt(sizeof(SuperBlock) + sizeof(MetadataBlock));
			this.total_bytes = BigInt(store._buffer.byteLength);
			store._write(this);
			store._write(this.metadata);
			return;
		}

		deserialize(this, store._buffer.subarray(0, sizeof(SuperBlock)));

		if (!checksumMatches(this)) throw crit(new ErrnoError(Errno.EIO, 'SingleBuffer: Checksum mismatch for super block!'));

		this.metadata = new MetadataBlock(this, this.metadata_offset);
	}

	/**
	 * The crc32c checksum for the super block.
	 * @privateRemarks Keep this first!
	 */
	@t.uint32 checksum: number = 0;

	/** Signature for the superblock. */
	@t.uint32 magic: number = sb_magic;

	/** The version of the on-disk format */
	@t.uint16 version: number = 1;

	/** Which format of `Inode` is used */
	@t.uint16 inode_format: number = _inode_version;

	/** Flags for the file system. Currently unused */
	@t.uint32 flags: number = 0;

	/** The number of used bytes, including the super block and metadata */
	@t.uint64 used_bytes: bigint = BigInt(0);

	/** The total size of the entire file system, including the super block and metadata */
	@t.uint64 total_bytes: bigint = BigInt(0);

	/** An ID for this file system */
	@t.uint128 id: bigint = BigInt(0);

	/**
	 * The size in bytes of a metadata block.
	 * Not currently configurable.
	 */
	@t.uint32 metadata_block_size: number = sizeof(MetadataBlock);

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected metadata_offset_: number = 0;
	/** Offset of the current metadata block */
	@t.uint32 metadata_offset: number = 0;

	public metadata: MetadataBlock;

	/** An optional label for the file system */
	@t.char(64) label: string = '';

	/** Padded to 256 bytes */
	@t.char(132) _padding: number[] = new Array(132).fill(0);

	/**
	 * Rotate out the current metadata block.
	 * Allocates a new metadata block, moves the current one to backup,
	 * and updates used_bytes accordingly.
	 * @returns the new metadata block
	 */
	public rotateMetadata(): MetadataBlock {
		const metadata = new MetadataBlock(this);
		metadata.offset = Number(this.used_bytes);
		metadata.previous_offset = this.metadata_offset;

		this.metadata = metadata;
		this.metadata_offset = metadata.offset;
		this.store._write(metadata);

		this.used_bytes += BigInt(sizeof(MetadataBlock));
		this.store._write(this);

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
			if (offset < block.offset + sizeof(MetadataBlock) && offset + length > block.offset) return false;

			for (const entry of block.entries) {
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
}

function checksumMatches(value: SuperBlock | MetadataBlock): boolean {
	const buffer = serialize(value);
	const computed = crc32c(buffer.subarray(4)); // note we don't include the checksum when computing a new one.
	return value.checksum === computed;
}

/**
 *
 * @category Stores and Transactions
 */
export class SingleBufferStore implements SyncMapStore {
	public readonly flags = [] as const;
	public readonly name = 'sbfs';
	public readonly id = 0x73626673; // 'sbfs'

	protected superblock: SuperBlock;

	/**
	 * @internal @hidden
	 */
	readonly _view: DataView;

	/**
	 * @internal @hidden
	 */
	readonly _buffer: Uint8Array;

	public constructor(buffer: ArrayBufferLike | ArrayBufferView) {
		if (buffer.byteLength < sizeof(SuperBlock) + sizeof(MetadataBlock))
			throw crit(new ErrnoError(Errno.EINVAL, 'SingleBuffer: Buffer is too small for a file system'));

		this._view = !ArrayBuffer.isView(buffer) ? new DataView(buffer) : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		this._buffer = !ArrayBuffer.isView(buffer) ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		this.superblock = new SuperBlock(this);
	}

	/**
	 * Update a block's checksum and write it to the store's buffer.
	 * @internal @hidden
	 */
	_write(value: SuperBlock | MetadataBlock): void {
		value.checksum = crc32c(serialize(value).subarray(4));
		const offset = 'offset' in value ? value.offset : 0;
		this._buffer.set(serialize(value), offset);
	}

	public keys(): Iterable<number> {
		const keys = new Set<number>();
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			for (const entry of block.entries) if (entry.offset) keys.add(entry.id);
		}
		return keys;
	}

	public get(id: number): Uint8Array | undefined {
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			for (const entry of block.entries) {
				if (entry.offset && entry.id == id) {
					return this._buffer.subarray(entry.offset, entry.offset + entry.size);
				}
			}
		}
	}

	public set(id: number, data: Uint8Array): void {
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			for (const entry of block.entries) {
				if (!entry.offset || entry.id != id) continue;

				if (data.length <= entry.size) {
					this._buffer.set(data, entry.offset);
					if (data.length < entry.size) {
						entry.size = data.length;
						this._write(block);
					}
					return;
				}

				if (this.superblock.isUnused(entry.offset, data.length)) {
					entry.size = data.length;
					this._buffer.set(data, entry.offset);
					this._write(block);
					return;
				}

				const used_bytes = Number(this.superblock.used_bytes);

				for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
					for (const entry of block.entries) {
						if (entry.offset != used_bytes) continue;
						entry.offset += data.length;
						this._write(block);
						break;
					}
				}

				entry.offset = used_bytes;
				entry.size = data.length;
				this._buffer.set(data, entry.offset);
				this._write(block);
				this.superblock.used_bytes += BigInt(data.length);
				this._write(this.superblock);
				return;
			}
		}

		let entry = this.superblock.metadata.entries.find(e => !e.offset);

		if (!entry) {
			this.superblock.rotateMetadata();
			entry = this.superblock.metadata.entries[0];
		}

		const offset = Number(this.superblock.used_bytes);

		entry.id = id;
		entry.offset = offset;
		entry.size = data.length;

		this._buffer.set(data, offset);

		this.superblock.used_bytes += BigInt(data.length);
		this._write(this.superblock.metadata);
		this._write(this.superblock);
	}

	public delete(id: number): void {
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			for (const entry of block.entries) {
				if (entry.id != id) continue;
				entry.offset = 0;
				entry.size = 0;
				this._write(block);
				return;
			}
		}
	}

	_fs?: StoreFS<Store> | undefined;

	public sync(): Promise<void> {
		return Promise.resolve();
	}

	public usage(): UsageInfo {
		return {
			totalSpace: Number(this.superblock.total_bytes),
			freeSpace: Number(this.superblock.total_bytes - this.superblock.used_bytes),
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
	create({ buffer }: SingleBufferOptions) {
		const fs = new StoreFS(new SingleBufferStore(buffer));
		fs.checkRootSync();
		return fs;
	},
} as const satisfies Backend<StoreFS<SingleBufferStore>, SingleBufferOptions>;
type _SingleBuffer = typeof _SingleBuffer;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SingleBuffer extends _SingleBuffer {}

/**
 * A backend that uses a single buffer for storing data
 * @category Backends and Configuration
 */
export const SingleBuffer: SingleBuffer = _SingleBuffer;
