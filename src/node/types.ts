// SPDX-License-Identifier: LGPL-3.0-or-later
import type * as fs from 'node:fs';
import type { Stream } from 'node:stream';

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
 *	- Static members that `ReadStream` and `WriteStream` inherit from `node:stream` are omitted since they aren't part of the `fs` API
 * @internal @hidden
 */
export type NodeFS = {
	[K in keyof typeof fs]: (typeof fs)[K] extends (...args: any[]) => any
		? // Some kind of wizardry: by using a union with a regular function, overloads are preserved but the properties disappear.
			(typeof fs)[K] | ((...args: any[]) => any)
		: (typeof fs)[K] extends object
			? Omit<(typeof fs)[K], '__promisify__' | 'native' | (K extends 'ReadStream' | 'WriteStream' ? StreamStatics : never)>
			: (typeof fs)[K];
};

/** @internal @hidden */
type StreamStatics = Exclude<keyof typeof Stream, 'prototype'>;

// Helper types to make other types more readable

/** Helper union @hidden */
export type GlobOptionsU = fs.GlobOptionsWithFileTypes | fs.GlobOptionsWithoutFileTypes | fs.GlobOptions;
