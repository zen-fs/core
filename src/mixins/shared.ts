/* eslint-disable @typescript-eslint/no-explicit-any */
/*
	Code shared by various mixins
*/

import type { ExtractProperties } from 'utilium';
import type { FileSystem } from '../internal/filesystem.js';

/**
 * `TBase` with `TMixin` mixed-in.
 * @internal
 */
export type Mixin<TBase extends typeof FileSystem, TMixin> = (abstract new (...args: any[]) => TMixin) & TBase;

/**
 * @internal @hidden
 * Note this include `existsSync`, even though it is a concrete method.
 */
export type _SyncFSKeys = Exclude<Extract<keyof FileSystem, `${string}Sync`>, '_disableSync'>;

/**
 * @internal @hidden
 * Note this include `exists`, even though it is a concrete method.
 */
export type _AsyncFSKeys = {
	[K in _SyncFSKeys]: K extends `${infer T}Sync` ? T : never;
}[_SyncFSKeys];

/**
 * Asynchronous `FileSystem` methods. This is a convenience type for all of the async operations.
 * @internal
 */
export type AsyncFSMethods = Pick<FileSystem, _AsyncFSKeys>;

/**
 * Concrete `FileSystem`. This is a convenience type.
 * @internal
 */
export type ConcreteFS = ExtractProperties<FileSystem, any>;
