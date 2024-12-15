import { List } from 'utilium';

export const enum Level {
	/** Emergency */
	EMERG,
	/** Alert */
	ALERT,
	/** Critical */
	CRIT,
	/** Error */
	ERR,
	/** Warning */
	WARN,
	/** Notice */
	NOTICE,
	/** Informational */
	INFO,
	/** Debug */
	DEBUG,
}

export const levels = {
	[Level.EMERG]: 'emergency',
	[Level.ALERT]: 'alert',
	[Level.CRIT]: 'critical',
	[Level.ERR]: 'error',
	[Level.WARN]: 'warning',
	[Level.NOTICE]: 'notice',
	[Level.INFO]: 'informational',
	[Level.DEBUG]: 'debug',
} as const satisfies Record<Level, string>;

export interface Entry {
	level: Level;
	message: string;
	/**
	 * time elapsed since `Performance.timeOrigin `
	 * @see performance.now
	 */
	time: number;
}

export const entries = new List<Entry>();

export function write(level: Level, message: string): void {
	entries.add({ level, message, time: performance.now() });
}
