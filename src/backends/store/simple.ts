/* node:coverage disable */
import { log_deprecated } from '../../log.js';
import type { AsyncMap, SyncMapStore } from './map.js';
import { SyncMapTransaction } from './map.js';
import type { Store } from './store.js';

/**
 * @deprecated Use `MapStore` instead.
 */
export type SimpleSyncStore = SyncMapStore;

/**
 * @deprecated Use `AsyncMapStore` instead.
 */
export type SimpleAsyncStore = AsyncMap & Store;

/**
 * @deprecated Use `MapTransaction` instead.
 */
export class SimpleTransaction extends SyncMapTransaction {
	constructor(store: SyncMapStore) {
		log_deprecated('SimpleTransaction');
		super(store);
	}
}
/* node:coverage enable */
