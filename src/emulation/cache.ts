/* Experimental caching */

import type { Stats } from '../stats.js';

/**
 * Used for caching data
 * @internal
 */
export class Cache<T> {
	public isEnabled: boolean = false;

	protected sync = new Map<string, T>();

	protected async = new Map<string, Promise<T>>();

	/**
	 * Whether the data exists in the cache
	 */
	hasSync(path: string): boolean {
		return this.isEnabled && this.sync.has(path);
	}

	/**
	 * Gets data from the cache, if is exists and the cache is enabled.
	 */
	getSync(path: string): T | undefined {
		if (!this.isEnabled) return;

		return this.sync.get(path);
	}

	/**
	 * Adds data if the cache is enabled
	 */
	setSync(path: string, value: T): void {
		if (!this.isEnabled) return;

		this.sync.set(path, value);
		this.async.set(path, Promise.resolve(value));
	}

	/**
	 * Whether the data exists in the cache
	 */
	has(path: string): boolean {
		return this.isEnabled && this.async.has(path);
	}

	/**
	 * Gets data from the cache, if it exists and the cache is enabled.
	 */
	get(path: string): Promise<T> | undefined {
		if (!this.isEnabled) return;

		return this.async.get(path);
	}

	/**
	 * Adds data if the cache is enabled
	 */
	set(path: string, value: Promise<T>): void {
		if (!this.isEnabled) return;

		this.async.set(path, value);
		void value.then(v => this.sync.set(path, v));
	}

	/**
	 * Clears the cache if it is enabled
	 */
	clear(): void {
		if (!this.isEnabled) return;
		this.sync.clear();
		this.async.clear();
	}
}

/**
 * Used to cache
 */
export const stats = new Cache<Stats>();

/**
 * Used to cache realpath lookups
 */
export const paths = new Cache<string>();
