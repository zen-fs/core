/* @todo [BREAKING] Remove */

import type { AsyncMapStore, MapStore } from './map.js';
import { MapTransaction } from './map.js';

/**
 * @deprecated Use `MapStore` instead.
 */
export type SimpleSyncStore = MapStore;

/**
 * @deprecated Use `AsyncMapStore` instead.
 */
export type SimpleAsyncStore = AsyncMapStore;

/**
 * @deprecated Use `MapTransaction` instead.
 */
export class SimpleTransaction extends MapTransaction {}
