/* Experimental caching */

import type { Stats } from '../stats.js';

/**
 * Whether the cache is enabled
 */
export let isEnabled = false;

/**
 * Sets whether the cache is enabled or not
 */
export function setEnabled(value: boolean): void {
	isEnabled = value;
}

const stats = new Map<string, Stats>();

/**
 * Gets stats from the cache, if they exist and the cache is enabled.
 */
export function getStats(path: string): Stats | undefined {
	if (!isEnabled) return;

	return stats.get(path);
}

/**
 * Adds stats if the cache is enabled
 */
export function setStats(path: string, value: Stats): void {
	if (!isEnabled) return;

	stats.set(path, value);
}

/**
 * Clears the cache if it is enabled
 */
export function clearStats(): void {
	if (!isEnabled) return;

	stats.clear();
}
