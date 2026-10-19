// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Backend } from '../backend.js';
import { StoreFS } from '../store/fs.js';
import { SingleBufferStore } from './v1.js';

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
		const [buffer, byteOffset, byteLength] = ArrayBuffer.isView(opt.buffer)
			? [opt.buffer.buffer, opt.buffer.byteOffset, opt.buffer.byteLength]
			: [opt.buffer, 0, opt.buffer.byteLength];

		const store = new SingleBufferStore(buffer, byteOffset, byteLength);

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
