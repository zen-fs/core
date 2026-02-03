// SPDX-License-Identifier: LGPL-3.0-or-later
import type * as fs from 'node:fs';

/**
 * @hidden
 */
export type NodeReaddirOptions =
	| {
			withFileTypes?: boolean;
			recursive?: boolean;
			encoding?: BufferEncoding | 'buffer' | null;
	  }
	| BufferEncoding
	| 'buffer'
	| null;

/**
 * Notes on omissions and exclusions:
 *	- `__promisify__` is omitted since it is type metadata
 *	- `native` is omitted since zenfs isn't native
 * @internal @hidden
 */
export type NodeFS = {
	[K in keyof typeof fs]: (typeof fs)[K] extends (...args: any[]) => any
		? // Some kind of wizardry: by using a union with a regular function, overloads are preserved but the properties disappear.
				(typeof fs)[K] | ((...args: any[]) => any)
		: (typeof fs)[K] extends object
			? Omit<(typeof fs)[K], '__promisify__' | 'native'>
			: (typeof fs)[K];
};

// Helper types to make other types more readable

/** Helper union @hidden */
export type GlobOptionsU = fs.GlobOptionsWithFileTypes | fs.GlobOptionsWithoutFileTypes | fs.GlobOptions;
