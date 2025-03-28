import { withErrno } from 'kerium';
import { alert, crit, err, warn } from 'kerium/log';
import { field, offsetof, packed, sizeof, struct, types as t, type StructArray } from 'memium';
import type { UUID } from 'node:crypto';
import { randomInt } from 'utilium';
import { BufferView } from 'utilium/buffer.js';
import { crc32c } from 'utilium/checksum.js';
import { decodeUUID, encodeUUID } from 'utilium/string.js';
import type { UsageInfo } from '../internal/filesystem.js';
import { _inode_version, Inode } from '../internal/inode.js';
import { size_max } from '../vfs/constants.js';
import type { Backend } from './backend.js';
import { StoreFS } from './store/fs.js';
import { SyncMapTransaction, type SyncMapStore } from './store/map.js';
import type { Store } from './store/store.js';

interface Lock extends Disposable {
	nonce: number;
	release(): void;
}

// eslint-disable-next-line @typescript-eslint/unbound-method
const { format } = new Intl.NumberFormat('en-US', {
	notation: 'compact',
	maximumFractionDigits: 2,
	unit: 'byte',
	unitDisplay: 'narrow',
});

@struct(packed)
class MetadataEntry extends BufferView {
	/** Inode or data ID */
	@t.uint32 accessor id!: number;

	/** Reserved for 64-bit offset expansion */
	@t.uint32 protected accessor offset_!: number;

	/** Offset into the buffer the data is stored at. */
	@t.uint32 accessor offset!: number;

	/** The size of the data */
	@t.uint32 accessor size!: number;

	toString(long: boolean = false) {
		if (!long) return `<MetadataEntry @ 0x${this.byteOffset.toString(16).padStart(8, '0')}>`;

		return `0x${this.id.toString(16).padStart(8, '0')}: ${format(this.size).padStart(5)} at 0x${this.offset.toString(16).padStart(8, '0')}`;
	}
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
@struct(packed)
export class MetadataBlock extends Int32Array<ArrayBufferLike> {
	declare readonly ['constructor']: typeof MetadataBlock;

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

	protected get offsetHex(): string {
		return '0x' + this.byteOffset.toString(16).padStart(8, '0');
	}

	/** Metadata entries. */
	@field(MetadataEntry, { length: entries_per_block }) accessor items!: StructArray<MetadataEntry>;

	toString(long: boolean = false) {
		if (!long) return `<MetadataBlock @ ${this.offsetHex}>`;

		let text = [
			`----- Metadata block at ${this.offsetHex} -----`,
			'Checksum: ' + this.checksum.toString(16).padStart(8, '0'),
			'Last updated: ' + new Date(Number(this.timestamp)).toLocaleString(),
			'Previous block: 0x' + this.previous_offset.toString(16).padStart(8, '0'),
			'Entries:',
		].join('\n');

		for (const entry of this.items) {
			if (!entry.offset) continue;
			text += '\n\t' + entry.toString(long);
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
			throw crit(withErrno('EBUSY', `sbfs: exceeded max attempts waiting for metadata block at ${this.offsetHex} to be unlocked`));

		const i = offsetof(this, 'locked');
		if (Atomics.load(this, i) !== 0) {
			switch (Atomics.wait(this, i, 0)) {
				case 'ok':
					break;
				case 'not-equal':
					depth++;
					err(`sbfs: waiting for metadata block at ${this.offsetHex} to be unlocked (${depth}/${max_lock_attempts})`);
					return this.waitUnlocked(depth);
				case 'timed-out':
					throw crit(withErrno('EBUSY', `sbfs: timed out waiting for metadata block at ${this.offsetHex} to be unlocked`));
			}
		}
	}

	public lock(nonce: number = randomInt(1, size_max / 2)): Lock {
		this.waitUnlocked();

		const i = offsetof(this, 'locked');
		Atomics.store(this, i, nonce);

		const release = () => {
			Atomics.store(this, i, 0);
			Atomics.notify(this, i, 1);
		};

		return {
			nonce,
			release,
			[Symbol.dispose]() {
				release();
			},
		};
	}
}

const sb_magic = 0x62732e7a; // 'z.sb'

/**
 * The super block structure for a single-buffer file system
 */
@struct(packed)
export class SuperBlock extends BufferView {
	declare readonly ['constructor']: typeof SuperBlock;

	public constructor(...args: ConstructorParameters<typeof BufferView>) {
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
				version: 1,
				inode_format: _inode_version,
				metadata_block_size: sizeof(MetadataBlock),
				uuid: encodeUUID(crypto.randomUUID()),
			});
			_update(this);
			_update(md);
			return;
		}

		if (!checksumMatches(this)) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for super block'));

		this.metadata = new MetadataBlock(this.buffer, this.metadata_offset);

		if (!checksumMatches(this.metadata))
			throw crit(
				withErrno(
					'EIO',
					`sbfs: checksum mismatch for metadata block (saved ${this.metadata.checksum.toString(16).padStart(8, '0')}, computed ${checksum(this.metadata).toString(16).padStart(8, '0')})`
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

	/** Padded to 256 bytes */
	@t.char(132) accessor _padding!: Uint8Array;

	/**
	 * Rotate out the current metadata block.
	 * Allocates a new metadata block, moves the current one to backup,
	 * and updates used_bytes accordingly.
	 * @returns the new metadata block
	 */
	public rotateMetadata(): MetadataBlock {
		const metadata = new MetadataBlock(this.buffer, Number(this.used_bytes));
		metadata.previous_offset = this.metadata_offset;

		this.metadata = metadata;
		this.metadata_offset = metadata.byteOffset;
		_update(metadata);

		this.used_bytes += BigInt(sizeof(MetadataBlock));
		_update(this);

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
}

/**
 * Compute the checksum for a super block or metadata block.
 * Note we don't include the checksum when computing a new one.
 */
function checksum(value: SuperBlock | MetadataBlock): number {
	const buffer = new Uint8Array(value.buffer, value.byteOffset + 4, sizeof(value) - 4);
	return crc32c(buffer);
}

function checksumMatches(value: SuperBlock | MetadataBlock): boolean {
	return value.checksum === checksum(value);
}

/**
 * Update a block's checksum and write it to the store's buffer.
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

	public keys(): Iterable<number> {
		const keys = new Set<number>();
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			block.waitUnlocked();
			for (const entry of block.items) if (entry.offset) keys.add(entry.id);
		}
		return keys;
	}

	public get(id: number): Uint8Array | undefined {
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			block.waitUnlocked();
			for (const entry of block.items) {
				if (entry.offset && entry.id == id) {
					return new Uint8Array(this.buffer, entry.offset, entry.size);
				}
			}
		}
	}

	public set(id: number, data: Uint8Array): void {
		if (id === 0 && data.length < sizeof(Inode)) throw alert(withErrno('EIO', `sbfs: tried to set ${data.length} bytes for id 0!`));

		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			block.waitUnlocked();
			for (const entry of block.items) {
				if (!entry.offset || entry.id != id) continue;

				using lock = block.lock();

				const _write = () => {
					for (let i = 0; i < data.length; i++) this._u8[entry.offset + i] = data[i];
				};

				if (data.length <= entry.size) {
					_write();
					if (data.length < entry.size) {
						entry.size = data.length;
						_update(block);
					}
					return;
				}

				if (this.superblock.isUnused(entry.offset, data.length)) {
					entry.size = data.length;
					_write();
					_update(block);
					return;
				}

				entry.offset = Number(this.superblock.used_bytes);
				entry.size = data.length;
				_write();
				_update(block);
				this.superblock.used_bytes += BigInt(data.length);
				_update(this.superblock);
				return;
			}
		}

		let entry = Array.from(this.superblock.metadata.items).find(e => !e.offset);

		if (!entry) {
			this.superblock.rotateMetadata();
			entry = this.superblock.metadata.items[0];
		}

		using lock = this.superblock.metadata.lock();

		const offset = Number(this.superblock.used_bytes);

		entry.id = id;
		entry.offset = offset;
		entry.size = data.length;

		for (let i = 0; i < data.length; i++) this._u8[offset + i] = data[i];

		this.superblock.used_bytes += BigInt(data.length);
		_update(this.superblock.metadata);
		_update(this.superblock);
	}

	public delete(id: number): void {
		for (let block: MetadataBlock | undefined = this.superblock.metadata; block; block = block.previous) {
			block.waitUnlocked();
			for (const entry of block.items) {
				if (entry.id != id) continue;
				entry.offset = 0;
				entry.size = 0;
				_update(block);
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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SingleBuffer extends _SingleBuffer {}

/**
 * A backend that uses a single buffer for storing data
 * @category Backends and Configuration
 */
export const SingleBuffer: SingleBuffer = _SingleBuffer;
