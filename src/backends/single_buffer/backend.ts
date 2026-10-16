// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Backend } from '../backend.js';
import { StoreFS } from '../store/fs.js';
import { sb_magic, SingleBufferStore } from './v1.js';
import { sb_version, SingleBufferStoreV2 } from './v2.js';

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

		const view = new DataView(buffer, byteOffset, byteLength);
		const isV2 = byteLength >= 12 && view.getUint32(4, true) == sb_magic && view.getUint16(8, true) >= sb_version;

		const store =
			opt.v2 || isV2 ? new SingleBufferStoreV2(buffer, byteOffset, byteLength) : new SingleBufferStore(buffer, byteOffset, byteLength);

		const fs = new StoreFS(store);
		fs.checkRootSync();
		return fs;
	},
} as const satisfies Backend<StoreFS<SingleBufferStore | SingleBufferStoreV2>, SingleBufferOptions>;
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
