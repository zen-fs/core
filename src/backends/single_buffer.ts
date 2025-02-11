import { deserialize, member, offsetof, serialize, sizeof, struct, types as t } from 'utilium';
import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { SyncMapTransaction, type SyncMapStore } from './store/map.js';
import type { Store } from './store/store.js';
import { _inode_version } from '../internal/inode.js';
import { crit, warn } from '../internal/log.js';
import { Errno, ErrnoError } from '../internal/error.js';
import { crc32c } from 'utilium/checksum.js';
import type { UsageInfo } from '../internal/filesystem.js';

@struct()
class MetadataEntry {
	/** Inode or data ID */
	@t.uint32 id: number = 0;

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected offset_: number = 0;

	/** Offset into the buffer the data is stored at */
	@t.uint32 offset: number = 0;

	/** The size of the data */
	@t.uint32 size: number = 0;
}

/**
 * A block of metadata for a single-buffer file system.
 * This metadata maps IDs (for inodes and data) to actual offsets in the buffer.
 * This is done since IDs are not guaranteed to be sequential.
 */
@struct()
class MetadataBlock {
	public constructor(
		protected readonly store: SingleBufferStore,
		protected readonly offset: number
	) {
		deserialize(this, store._buffer.subarray(offset, offset + sizeof(MetadataBlock)));

		if (!checksumMatches(this))
			throw crit(new ErrnoError(Errno.EIO, 'SingleBuffer: Checksum mismatch for metadata block at 0x' + offset.toString(16)));
	}

	/**
	 * The crc32c checksum for the metadata block.
	 * @privateRemarks Keep this first!
	 */
	@t.uint32 checksum: number = 0;

	/** Which generation this metadata block is for */
	@t.uint32 generation: number = 0;

	/** The (last) time this metadata block was updated */
	@t.uint32 timestamp: number = Date.now();

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected previous_offset_: number = 0;
	/** Offset to the previous metadata block */
	@t.uint32 previous_offset: number = 0;

	protected _previous?: MetadataBlock;

	public get previous(): MetadataBlock | undefined {
		if (!this.previous_offset) return;
		this._previous ??= new MetadataBlock(this.store, this.previous_offset);
		return this._previous;
	}

	/** Align to 16 bytes */
	@t.uint32(3) protected _padding: number[] = new Array(3).fill(0);

	/**
	 * Metadata entries.
	 * @privateRemarks The number of entries is based on having a 4 KiB block.
	 */
	@member(MetadataEntry, 254) entries = new Array(254).map(() => new MetadataEntry());
}

const sb_magic = 0x7a2e7362; // 'z.sb'

/**
 * The super block structure for a single-buffer file system
 */
@struct()
class SuperBlock {
	public constructor(protected readonly store: SingleBufferStore) {
		if (store._view.getUint32(offsetof(SuperBlock, 'magic'), true) != sb_magic) {
			warn('SingleBuffer: Invalid magic value. Assuming this is a fresh super block.');
			return;
		}

		deserialize(this, store._buffer.subarray(0, sizeof(SuperBlock)));

		if (!checksumMatches(this)) throw crit(new ErrnoError(Errno.EIO, 'SingleBuffer: Checksum mismatch for super block!'));
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

	/** What generation we are on. This is used for versioning data */
	@t.uint32 generation: number = 0;

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

	protected _metadata?: MetadataBlock;

	public get metadata(): MetadataBlock | undefined {
		if (!this.metadata_offset) return;
		this._metadata ??= new MetadataBlock(this.store, this.metadata_offset);
		return this._metadata;
	}

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected metadata_backup_offset_: number = 0;
	/** Offset of the backup metadata block */
	@t.uint32 metadata_backup_offset: number = 0;

	protected _metadata_backup?: MetadataBlock;

	public get metadata_backup(): MetadataBlock | undefined {
		if (!this.metadata_backup_offset) return;
		this._metadata_backup ??= new MetadataBlock(this.store, this.metadata_backup_offset);
		return this._metadata_backup;
	}

	/** An optional label for the file system */
	@t.char(64) label: string = '';

	/** Pad to 512 bytes */
	@t.char(376) _padding: number[] = new Array(380).fill(0);
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

	public readonly name = 'tmpfs';

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
			throw crit(new ErrnoError(Errno.EINVAL, 'SingleBuffer: Buffer is too small for a file system.'));

		this._view = !ArrayBuffer.isView(buffer) ? new DataView(buffer) : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		this._buffer = !ArrayBuffer.isView(buffer) ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		this.superblock = new SuperBlock(this);
	}

	public keys(): Iterable<number> {}

	public get(id: number): Uint8Array | undefined {}

	public set(id: number, data: Uint8Array): void {}

	public delete(id: number): void {}

	_fs?: StoreFS<Store> | undefined;

	public async sync(): Promise<void> {}

	public usage(): UsageInfo {}

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
