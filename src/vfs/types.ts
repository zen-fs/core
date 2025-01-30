import type * as fs from 'node:fs';

export type FileContents = ArrayBufferView | string;

/**
 * Options used for caching, among other things.
 * @internal @hidden *UNSTABLE*
 */
export interface InternalOptions {
	/**
	 * If true, then this readdir was called from another function.
	 * In this case, don't clear the cache when done.
	 * @internal *UNSTABLE*
	 */
	_isIndirect?: boolean;
}

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

export interface ReaddirOptions extends InternalOptions {
	withFileTypes?: boolean;
	recursive?: boolean;
}

// Helper types to make the vfs types more readable

/** Helper union @hidden */
export type GlobOptionsU = fs.GlobOptionsWithFileTypes | fs.GlobOptionsWithoutFileTypes | fs.GlobOptions;

/** Helper with union @hidden */
export type ReaddirOptsU<T> = (ReaddirOptions & (fs.ObjectEncodingOptions | T)) | NullEnc;

/** Helper with intersection @hidden */
export type ReaddirOptsI<T> = ReaddirOptions & fs.ObjectEncodingOptions & T;

/** @hidden */
export type NullEnc = BufferEncoding | null;
