/* Logging utilities. The things in this file are named to work nicely when you import as a namespace. */

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
	[Level.INFO]: 'info',
	[Level.DEBUG]: 'debug',
} as const satisfies Record<Level, string>;

function levelOf(value: (typeof levels)[Level]): Level {
	return +Object.keys(levels)[Object.values(levels).indexOf(value)];
}

export interface Entry {
	level: Level;
	timestamp: Date;
	elapsedMs: number;
	message: string;
}

export const entries = new List<Entry>();

export function log(level: Level, message: string) {
	const entry: Entry = {
		level,
		message,
		timestamp: new Date(),
		elapsedMs: performance.now(),
	};
	entries.add(entry);
	output(entry);
}

function _shortcut(level: Level) {
	return function <const T extends { toString(): string }>(message: T): T {
		log(level, message.toString());
		return message;
	};
}

// Shortcuts
export const emerg = _shortcut(Level.EMERG);
export const alert = _shortcut(Level.ALERT);
export const crit = _shortcut(Level.CRIT);
export const err = _shortcut(Level.ERR);
export const warn = _shortcut(Level.WARN);
export const notice = _shortcut(Level.NOTICE);
export const info = _shortcut(Level.INFO);
export const debug = _shortcut(Level.DEBUG);

// Formatting

export let format: (entry: Entry) => string = (entry: Entry) => {
	return `[${(entry.elapsedMs / 1000).toFixed(3).padStart(10)}] ${entry.message}`;
};

let _output: null | ((message: string) => unknown) = null;

function output(entry: Entry) {
	if (typeof minLevel == 'number' && entry.level > minLevel) return;
	_output?.(format(entry));
}

let minLevel: Level | null = null;

// Configuration

export interface Options {
	format?(this: void, entry: Entry): string;

	output(this: void, message: string): unknown;

	/** If set, output() all current entries after `configure` is done */
	dumpBacklog?: boolean;

	/**
	 * The minimum level needed to output a message
	 */
	level: Level | (typeof levels)[Level];
}

export function configure(options: Options) {
	format = options.format ?? format;
	_output = options.output;
	minLevel = typeof options.level == 'string' ? levelOf(options.level) : options.level;

	if (options.dumpBacklog) {
		for (const entry of entries) {
			output(entry);
		}
	}
}
