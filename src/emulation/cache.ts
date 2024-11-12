/* Experimental caching */

import type { Stats } from '../stats.js';

export class Cache<T> {
	public isEnabled: boolean = false;

	protected sync = new Map<string, T>();

	protected async = new Map<string, Promise<T | undefined>>();

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
	}

	/**
	 * Clears the cache if it is enabled
	 */
	clearSync(): void {
		if (!this.isEnabled) return;

		this.sync.clear();
	}

	/**
	 * Gets data from the cache, if it exists and the cache is enabled.
	 */
	get(path: string): Promise<T | undefined> | undefined {
		if (!this.isEnabled) return;

		return this.async.get(path);
	}

	/**
	 * Adds data if the cache is enabled
	 */
	set(path: string, value: Promise<T | undefined>): void {
		if (!this.isEnabled) return;

		this.async.set(path, value);
	}

	/**
	 * Clears the cache if it is enabled
	 */
	clear(): void {
		if (!this.isEnabled) return;

		this.async.clear();
	}
}

export const stats = new Cache<Stats>();
