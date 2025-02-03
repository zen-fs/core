import { log_deprecated } from '../../internal/log.js';
import type { AsyncMap, SyncMapStore } from './map.js';
import { SyncMapTransaction } from './map.js';
import type { Store } from './store.js';

/* node:coverage disable */
/**
 * @category Stores and Transactions
 * @deprecated Use `MapStore` instead.
 */
export type SimpleSyncStore = SyncMapStore;

/**
 * @category Stores and Transactions
 * @deprecated Use `AsyncMapStore` instead.
 */
export type SimpleAsyncStore = AsyncMap & Store;

/**
 * @category Stores and Transactions
 * @deprecated Use `MapTransaction` instead.
 */
export class SimpleTransaction extends SyncMapTransaction {
	constructor(store: SyncMapStore) {
		log_deprecated('SimpleTransaction');
		super(store);
	}
}
/* node:coverage enable */
