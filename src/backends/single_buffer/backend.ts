// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { crit, err, info, warn } from 'kerium/log';
import { offsetof, sizeof } from 'memium';
import { Mutex, type MutexGuard } from 'memium/locks';
import { crc32c } from 'utilium/checksum';
import { _inode_version } from '../../internal/inode.js';
import type { Backend } from '../backend.js';
import { StoreFS } from '../store/fs.js';
import * as v1 from './v1.js';
import * as v2 from './v2.js';

const hex = (value: number | bigint): string => '0x' + value.toString(16).padStart(8, '0');

/**
 * Options for the `SingleBuffer` backend
 * @category Backends and Configuration
 */
export interface SingleBufferOptions {
	buffer: ArrayBufferLike | ArrayBufferView;

	/**
	 * Create new file systems with version 2 of the format, and upgrade existing ones to it.
	 * File systems that already use version 2 always do.
	 */
	v2?: boolean;
}

/** The lock held while a file system is created or upgraded, which is in the padding of a version 1 super block */
const lockOffset = offsetof(v2.SuperBlock, 'lock');

/** Checksum of a version 1 super block, treating the lock as zero */
function v1Checksum(bytes: Uint8Array): number {
	const data = bytes.slice(4, sizeof(v1.SuperBlock));
	data.fill(0, lockOffset - 4, lockOffset + 4);
	return crc32c(data);
}

/** Locks a file system while it is created or upgraded. Only shared buffers are locked. */
function lockSetup(bytes: Uint8Array, view: DataView): MutexGuard | undefined {
	const word = new BigInt64Array(bytes.buffer, bytes.byteOffset + lockOffset, 1);
	const garbage = Atomics.load(word, 0);
	const isV1 = view.getUint32(4, true) == v1.sb_magic && view.getUint16(8, true) < 2;

	// The padding of a version 1 super block was never cleared
	if (garbage && isV1 && crc32c(bytes.subarray(4, sizeof(v1.SuperBlock))) == view.getUint32(0, true)) {
		if (Atomics.compareExchange(word, 0, garbage, 0n) === garbage) view.setUint32(0, v1Checksum(bytes), true);
	}

	if (typeof SharedArrayBuffer != 'undefined' && bytes.buffer instanceof SharedArrayBuffer)
		return new Mutex(bytes.buffer, bytes.byteOffset + lockOffset).lock();

	Atomics.store(word, 0, 0n);
}

/**
 * Upgrades a version 1 file system in place.
 * Existing data is not moved, and the version 1 metadata stays intact until the new super block is written.
 */
function upgrade(bytes: Uint8Array, view: DataView): v2.SingleBufferStore {
	info('sbfs: upgrading from version 1');

	const field = (name: string) => offsetof(v1.SuperBlock, name);

	if (v1Checksum(bytes) != view.getUint32(0, true)) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for version 1 super block'));
	if (view.getUint16(field('inode_format'), true) != _inode_version) throw crit(withErrno('EIO', 'sbfs: inode format mismatch'));
	if (view.getUint32(field('metadata_block_size'), true) != sizeof(v1.MetadataBlock))
		throw crit(withErrno('EIO', 'sbfs: metadata block size mismatch'));

	const total = Number(view.getBigUint64(field('total_bytes'), true));
	if (total > bytes.byteLength) throw crit(withErrno('EIO', 'sbfs: invalid size in version 1 super block'));

	const used: [start: number, end: number][] = [];
	const entries = new Map<number, [offset: number, size: number]>();
	const blocks: number[] = [];

	// Version 1 metadata block offsets are relative to the buffer, but data offsets are relative to the file system
	for (let absolute = view.getUint32(field('metadata_offset'), true); absolute;) {
		const offset = absolute - bytes.byteOffset;
		if (offset < sizeof(v1.SuperBlock) || offset + sizeof(v1.MetadataBlock) > total || blocks.includes(offset))
			throw crit(withErrno('EIO', `sbfs: invalid metadata block at ${hex(absolute)}`));

		const block = new v1.MetadataBlock(bytes.buffer, absolute);
		if (block.checksum != v1.checksum(block)) {
			if (!blocks.length) throw crit(withErrno('EIO', 'sbfs: checksum mismatch for metadata block'));
			warn(`sbfs: checksum mismatch for metadata block at ${hex(absolute)}`);
		}

		blocks.push(offset);
		used.push([offset, offset + sizeof(v1.MetadataBlock)]);

		for (const entry of block.items) {
			if (!entry.offset || entries.has(entry.id)) continue;
			if (entry.offset + entry.size > total) throw crit(withErrno('EIO', `sbfs: data for ${hex(entry.id)} is out of bounds`));

			entries.set(entry.id, [entry.size ? entry.offset : 0, entry.size]);
			if (entry.size) used.push([entry.offset, entry.offset + entry.size]);
		}

		absolute = block.previous_offset;
	}

	let maxId = 0;
	for (const id of entries.keys()) maxId = Math.max(maxId, id);

	const store = new v2.SingleBufferStore(bytes.buffer, bytes.byteOffset, bytes.byteLength, {
		format: {
			used,
			uuid: bytes.slice(field('uuid'), field('uuid') + 16),
			label: bytes.slice(field('label'), field('label') + 64),
			nextId: BigInt(Math.max(2, maxId + 1)),
			populate(tx) {
				for (const [id, [offset, size]] of entries)
					tx.index.set(BigInt(id), Object.assign(new v2.DataExtent(), { offset, size, capacity: size }));
				for (const block of blocks) tx.retire(block, sizeof(v1.MetadataBlock));
			},
		},
	});

	info(`sbfs: upgraded ${entries.size} entries from version 1`);
	return store;
}

const _SingleBuffer = {
	name: 'SingleBuffer',
	options: {
		buffer: { type: 'object', required: true },
		v2: { type: 'boolean', required: false },
	},
	create(opt: SingleBufferOptions) {
		const [buffer, byteOffset, byteLength] = ArrayBuffer.isView(opt.buffer)
			? [opt.buffer.buffer, opt.buffer.byteOffset, opt.buffer.byteLength]
			: [opt.buffer, 0, opt.buffer.byteLength];

		if (byteLength < sizeof(v1.SuperBlock)) throw crit(withErrno('EINVAL', 'sbfs: buffer is too small for a file system'));

		const bytes = new Uint8Array(buffer, byteOffset, byteLength);
		const view = new DataView(buffer, byteOffset, byteLength);

		const formatted = view.getUint32(4, true) == v1.sb_magic;
		using _ = opt.v2 || (!formatted && opt.v2 !== false) ? lockSetup(bytes, view) : undefined;

		let store: v1.SingleBufferStore | v2.SingleBufferStore;

		switch (view.getUint32(4, true) == v1.sb_magic ? view.getUint16(8, true) : undefined) {
			case undefined:
				store =
					opt.v2 === false
						? new v1.SingleBufferStore(buffer, byteOffset, byteLength)
						: new v2.SingleBufferStore(buffer, byteOffset, byteLength, { format: true });
				break;
			case 0:
				err('sbfs: got unexpected super block version 0');
			// falls through
			case 1:
				store = opt.v2 ? upgrade(bytes, view) : new v1.SingleBufferStore(buffer, byteOffset, byteLength);
				break;
			case 2:
				store = new v2.SingleBufferStore(buffer, byteOffset, byteLength);
				break;
			default:
				throw crit(withErrno('EIO', 'sbfs: unsupported super block version'));
		}

		const fs = new StoreFS(store);
		fs.checkRootSync();
		return fs;
	},
} as const satisfies Backend<StoreFS<v1.SingleBufferStore | v2.SingleBufferStore>, SingleBufferOptions>;
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
