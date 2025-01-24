/* node:coverage disable */
import { log_deprecated } from '../../log.js';
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
export class SimpleTransaction extends MapTransaction {
	constructor(store: MapStore) {
		log_deprecated('SimpleTransaction');
		super(store);
	}
}
/* node:coverage enable */
