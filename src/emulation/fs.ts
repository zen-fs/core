import * as fs_mock from './index.js';
import type * as fs_node from 'node:fs';

/**
 * fixes __promisify__
 */
type FSMock = {
	[K in keyof typeof fs_mock]: K extends keyof typeof fs_mock.promises
		? (typeof fs_mock.promises)[K] extends (...args) => Promise<unknown>
			? (typeof fs_node)[K] extends { __promisify__(...args): unknown }
				? (typeof fs_mock)[K] & { __promisify__: (typeof fs_node)[K]['__promisify__'] }
				: (typeof fs_mock)[K]
			: (typeof fs_mock)[K]
		: (typeof fs_mock)[K];
};

const fs: typeof fs_node & typeof fs_mock = fs_mock as FSMock;

export * from './index.js';
export default fs;
