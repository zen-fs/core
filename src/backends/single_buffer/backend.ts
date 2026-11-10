// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { crit } from 'kerium/log';
import { offsetof, sizeof } from 'memium';
import { Mutex, type MutexGuard } from 'memium/locks';
import type { Backend } from '../backend.js';
import { StoreFS } from '../store/fs.js';
import { sb_magic, SuperBlock } from './data.js';
import { SingleBufferStore } from './store.js';

/**
 * Options for the `SingleBuffer` backend
 * @category Backends and Configuration
 */
export interface SingleBufferOptions {
	buffer: ArrayBufferLike | ArrayBufferView;
}

const lockOffset = offsetof(SuperBlock, 'lock');

/** Locks a file system while it is created. Only shared buffers are locked. */
function lockSetup(bytes: Uint8Array): MutexGuard | undefined {
	if (typeof SharedArrayBuffer != 'undefined' && bytes.buffer instanceof SharedArrayBuffer)
		return new Mutex(bytes.buffer, bytes.byteOffset + lockOffset).lock();

	Atomics.store(new BigInt64Array(bytes.buffer, bytes.byteOffset + lockOffset, 1), 0, 0n);
}

const _SingleBuffer = {
	name: 'SingleBuffer',
	options: {
		buffer: { type: 'object', required: true },
	},
	create(opt: SingleBufferOptions) {
		const [buffer, byteOffset, byteLength] = ArrayBuffer.isView(opt.buffer)
			? [opt.buffer.buffer, opt.buffer.byteOffset, opt.buffer.byteLength]
			: [opt.buffer, 0, opt.buffer.byteLength];

		if (byteLength < sizeof(SuperBlock)) throw crit(withErrno('EINVAL', 'sbfs: buffer is too small for a file system'));

		const bytes = new Uint8Array(buffer, byteOffset, byteLength);
		const view = new DataView(buffer, byteOffset, byteLength);

		/** The format version, or `undefined` if the buffer has not been formatted */
		const version = () => (view.getUint32(4, true) == sb_magic ? view.getUint16(8, true) : undefined);

		using _ = version() === undefined ? lockSetup(bytes) : undefined;

		let store: SingleBufferStore;

		// Another thread may have formatted the buffer while this one waited for the lock
		switch (version()) {
			case undefined:
				store = new SingleBufferStore(buffer, byteOffset, byteLength, { format: true });
				break;
			case 2:
				store = new SingleBufferStore(buffer, byteOffset, byteLength);
				break;
			default:
				throw crit(withErrno('EIO', `sbfs: unsupported super block version ${version()}`));
		}

		const fs = new StoreFS(store);
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
