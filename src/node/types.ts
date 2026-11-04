// SPDX-License-Identifier: LGPL-3.0-or-later
import type * as fs from 'node:fs';
import type { Stream } from 'node:stream';
import type { SyncByteReadableStream, SyncTransform } from 'node:stream/iter';

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

declare module 'node:fs' {
	interface StatOptions {
		/** Aborts asynchronous `stat` and `lstat` calls */
		signal?: AbortSignal | undefined;
	}

	interface GlobOptions<T extends Dirent | string = Dirent | string> {
		/** Maximum number of directory levels to traverse, where `cwd` has a depth of 0 */
		maxDepth?: number | undefined;
	}
}

declare module 'node:fs/promises' {
	interface PullSyncOptions {
		/** Close the file handle when the iterable ends */
		autoClose?: boolean | undefined;
		/** Byte offset to begin reading from, instead of the current position */
		start?: number | undefined;
		/** Maximum number of bytes to read */
		limit?: number | undefined;
		/** Size of each read in bytes */
		chunkSize?: number | undefined;
	}

	interface FileHandle {
		/** Return the file contents as an iterable using synchronous reads */
		pullSync(...transforms: SyncTransform[]): SyncByteReadableStream;
		pullSync(...args: [...transforms: SyncTransform[], options: PullSyncOptions]): SyncByteReadableStream;
	}
}
