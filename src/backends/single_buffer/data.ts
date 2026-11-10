// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { crit } from 'kerium/log';
import { array, offsetof, sizeof, struct, types as t } from 'memium';
import { crc32c } from 'utilium/checksum';
import { _inode_version } from '../../internal/inode.js';

/** A range of bytes */
export class Extent extends struct.packed(
	'sbfs.Extent',
	{
		offset: t.uint32,
		size: t.uint32,
	},
	{ fastFields: true },
) {}

/** Where the data for an ID is stored */
export class DataExtent extends struct.extend(
	Extent,
	'sbfs.DataExtent',
	{
		/** Bytes allocated, which can exceed `size` so data can grow in place */
		capacity: t.uint32,
	},
	{ isPacked: true, fastFields: true },
) {}

/** The roots and allocator state written by a transaction */
export class Commit extends struct.packed(
	'sbfs.Commit',
	{
		/** crc32c of the rest of the commit */
		checksum: t.uint32,

		generation: t.uint64,

		/** ID to extent */
		index_root: t.uint32,
		index_count: t.uint32,

		/** Free extents by offset */
		free_root: t.uint32,

		/** Free extents by size then offset */
		size_root: t.uint32,

		free_count: t.uint32,
		free_bytes: t.uint32,

		/** The newest block in the list of spare blocks for tree nodes */
		spare_head: t.uint32,

		/** Spare blocks listed by `spare_head` */
		spare_count: t.uint32,

		/** Spare blocks in the entire list */
		spare_total: t.uint32,

		/** Blocks listing extents that are free once no reader can see them */
		pending_head: t.uint32,
		pending_tail: t.uint32,
		pending_bytes: t.uint32,
	},
	{ fastFields: true },
) {
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
export class State extends struct.packed(
	'sbfs.State',
	{
		/** Held by writers */
		lock: t.uint64,

		/** The generation of the current commit */
		generation: t.uint64,

		next_id: t.uint64,

		/** The current and previous commits, at their generation modulo 2 */
		commits: array(Commit, 2),
	},
	{ fastFields: true },
) {}

/** The start of a block listing extents retired by a generation, which is followed by the extents */
export class PendingHeader extends struct.packed(
	'sbfs.PendingHeader',
	{
		next: t.uint32,
		count: t.uint32,
		generation: t.uint64,
	},
	{ fastFields: true },
) {}

/**
 * The start of a block listing spare blocks, which is followed by their offsets.
 * The newest block's count is in the commit instead.
 */
export class SpareHeader extends struct.packed(
	'sbfs.SpareHeader',
	{
		next: t.uint32,
		count: t.uint32,
	},
	{ fastFields: true },
) {}

/**
 * Offsets are 32 bits
 * @internal @hidden
 */
export const max_size = 0xffffffff;

export const sb_magic = 0x62732e7a; // 'z.sb'

/**
 * The super block for the single-buffer format.
 * Bytes 0 through 12 have the same layout in every version.
 */
export class SuperBlock extends struct.packed(
	'sbfs.SuperBlock',
	{
		/** crc32c of the bytes from 4 up to `lock` */
		checksum: t.uint32,

		magic: t.uint32,

		/**
		 * The version of the on-disk format
		 * 1: v1.10.0+, append-only metadata blocks. No longer supported.
		 * 2: copy-on-write B+ trees
		 */
		version: t.uint16,

		/** Which format of `Inode` is used */
		inode_format: t.uint16,

		/** Features that must be supported to mount the file system. None are defined. */
		required_features: t.uint32,

		/** Features that may be ignored. None are defined. */
		optional_features: t.uint32,

		/** Size of tree nodes and other metadata blocks */
		block_size: t.uint32,

		/** The size of the entire file system, including the super block */
		total_bytes: t.uint64,

		uuid: t.uint8(16),

		/** Byte offset of the shared state */
		state_offset: t.uint32,

		epoch_slots: t.uint32,

		/** An optional label for the file system */
		label: t.char(64),

		_padding: t.char(128),

		/** Held while the file system is created or upgraded. Not covered by the checksum. */
		lock: t.uint64,
	},
	{ fastFields: true },
) {
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
