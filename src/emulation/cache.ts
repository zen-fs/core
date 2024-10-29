/* Experimental caching */

import type { Stats } from '../stats.js';

export let isEnabled = false;

export function setEnabled(value: boolean): void {
	isEnabled = value;
}

const stats = new Map<string, Stats>();

export function getStats(path: string): Stats | undefined {
	if (!isEnabled) return;

	return stats.get(path);
}

export function setStats(path: string, value: Stats): void {
	if (!isEnabled) return;

	stats.set(path, value);
}

export function clearStats(): void {
	if (!isEnabled) return;

	stats.clear();
}
