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

const statsSync = new Map<string, Stats>();

/**
 * Gets stats from the cache, if they exist and the cache is enabled.
 */
export function getStatsSync(path: string): Stats | undefined {
	if (!isEnabled) return;

	return statsSync.get(path);
}

/**
 * Adds stats if the cache is enabled
 */
export function setStatsSync(path: string, value: Stats): void {
	if (!isEnabled) return;

	statsSync.set(path, value);
}

/**
 * Clears the cache if it is enabled
 */
export function clearStatsSync(): void {
	if (!isEnabled) return;

	statsSync.clear();
}

const stats = new Map<string, Promise<Stats | undefined>>();

/**
 * Gets stats from the cache, if they exist and the cache is enabled.
 */
export function getStats(path: string): Promise<Stats | undefined> | undefined {
	if (!isEnabled) return;

	return stats.get(path);
}

/**
 * Adds stats if the cache is enabled
 */
export function setStats(path: string, value: Promise<Stats | undefined>): void {
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
