/* eslint-disable @typescript-eslint/no-explicit-any */
/*
	Code shared by various mixins
*/

import type { ExtractProperties } from 'utilium';
import type { FileSystem } from '../filesystem.js';

/**
 * `TBase` with `TMixin` mixed-in.
 * @internal
 */
export type Mixin<TBase extends typeof FileSystem, TMixin> = (abstract new (...args: any[]) => TMixin) & TBase;

/**
 * Asynchronous `FileSystem` methods. This is a convenience type.
 * @internal
 */
export type AsyncFSMethods = ExtractProperties<FileSystem, (...args: any[]) => Promise<unknown>>;

/**
 * Concrete `FileSystem`. This is a convenience type.
 * @internal
 */
export type ConcreteFS = ExtractProperties<FileSystem, any>;
