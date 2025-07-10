/* eslint-disable @typescript-eslint/no-empty-object-type,@typescript-eslint/no-explicit-any */
/*
	Code shared by various mixins
*/

import type { ExtractProperties } from 'utilium';
import type { FileSystem } from '../internal/filesystem.js';

/**
 * `TBase` with `TMixin` mixed-in.
 * @category Internals
 * @internal
 */
export type Mixin<TBase extends typeof FileSystem, TMixin> = (abstract new (...args: any[]) => TMixin) & TBase;

/**
 * @internal @hidden
 * Note this includes `existsSync`, even though it is a concrete method.
 */
export type _SyncFSKeys = Exclude<Extract<keyof FileSystem, `${string}Sync`>, '_disableSync'>;

/**
 * @internal @hidden
 * Note this includes `exists`, even though it is a concrete method.
 */
export type _AsyncFSKeys = {
	[K in _SyncFSKeys]: K extends `${infer T}Sync` ? T : never;
}[_SyncFSKeys];

export const _asyncFSKeys = [
	'rename',
	'stat',
	'touch',
	'createFile',
	'unlink',
	'rmdir',
	'mkdir',
	'readdir',
	'exists',
	'link',
	'sync',
	'read',
	'write',
] as const satisfies _AsyncFSKeys[];

/**
 * Asynchronous `FileSystem` methods. This is a convenience type for all of the async operations.
 * @category Internals
 * @internal
 */
export interface AsyncFSMethods extends Pick<FileSystem, _AsyncFSKeys> {}

/**
 * Concrete `FileSystem`. This is a convenience type.
 * @category Internals
 * @internal
 */
export interface ConcreteFS extends ExtractProperties<FileSystem, any> {}
