// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { crit } from 'kerium/log';
import type { ArrayOf } from 'memium';
import { array, offsetof, sizeof } from 'memium';
import { $from, field, struct, types as t } from 'memium/decorators';
import { BufferView } from 'utilium/buffer';
import { crc32c } from 'utilium/checksum';
import { _inode_version } from '../../internal/inode.js';

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
 * Offsets are 32 bits
 * @internal @hidden
 */
export const max_size = 0xffffffff;

export const sb_magic = 0x62732e7a; // 'z.sb'

/**
 * The super block for the single-buffer format.
 * Bytes 0 through 12 have the same layout in every version.
 */
@struct.packed()
export class SuperBlock extends $from(BufferView) {
	static name = 'sbfs.SuperBlock';

	/** crc32c of the bytes from 4 up to `lock` */
	@t.uint32 accessor checksum!: number;

	@t.uint32 accessor magic!: number;

	/**
	 * The version of the on-disk format
	 * 1: v1.10.0+, append-only metadata blocks. No longer supported.
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
