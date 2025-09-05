// SPDX-License-Identifier: LGPL-3.0-or-later
import type * as fs from 'node:fs';

export type FileContents = ArrayBufferView | string;

/**
 * @internal @hidden Used for the internal `_open` functions
 */
export interface OpenOptions {
	flag: fs.OpenMode;
	mode?: fs.Mode | null;
	/**
	 * If true, do not resolve symlinks
	 */
	preserveSymlinks?: boolean;
	/**
	 * If true, allows opening directories
	 */
	allowDirectory?: boolean;
}

export type ReaddirOptions =
	| {
			withFileTypes?: boolean;
			recursive?: boolean;
			encoding?: BufferEncoding | 'buffer' | null;
	  }
	| BufferEncoding
	| 'buffer'
	| null;

// Helper types to make the vfs types more readable

/** Helper union @hidden */
export type GlobOptionsU = fs.GlobOptionsWithFileTypes | fs.GlobOptionsWithoutFileTypes | fs.GlobOptions;
