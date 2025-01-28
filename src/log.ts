/* Logging utilities. The things in this file are named to work nicely when you import as a namespace. */

import { List } from 'utilium';
import { ErrnoError } from './error.js';
import type { FileSystem } from './filesystem.js';
import { join } from './vfs/path.js';

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

/** An object mapping log levels to a textual representation of them */
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

export function levelOf(value: (typeof levels)[Level]): Level {
	return Object.values(levels).indexOf(value);
}

/** A log entry */
export interface Entry {
	level: Level;
	timestamp: Date;
	elapsedMs: number;
	message: string;
}

/** The list of log entries */
export const entries = new List<Entry>();

export function log(level: Level, message: string) {
	if (!isEnabled) return;
	const entry: Entry = {
		level,
		message,
		timestamp: new Date(),
		elapsedMs: performance.now(),
	};
	entries.add(entry);
	output(entry);
}

interface LogShortcutOptions {
	fs?: FileSystem;
}

function _messageString(msg: { toString(): string } | ErrnoError, options: LogShortcutOptions): string {
	if (!(msg instanceof ErrnoError)) return msg.toString();

	const beforePath = msg.code + ': ' + msg.message;

	if (!msg.path) return beforePath;

	const mountPoint = typeof options.fs == 'string' ? options.fs : (options.fs?._mountPoint ?? '<unknown>');

	return beforePath + ': ' + join(mountPoint, msg.path);
}

function _shortcut(level: Level) {
	return function <T extends { toString(): string } | ErrnoError>(message: T, options: LogShortcutOptions = {}): T {
		log(level, _messageString(message, options));
		return message;
	};
}

// Shortcuts

/** Shortcut for logging emergencies */
export const emerg = _shortcut(Level.EMERG);
/** Shortcut for logging alerts */
export const alert = _shortcut(Level.ALERT);
/** Shortcut for logging critical errors */
export const crit = _shortcut(Level.CRIT);
/** Shortcut for logging non-critical errors */
export const err = _shortcut(Level.ERR);
/** Shortcut for logging warnings */
export const warn = _shortcut(Level.WARN);
/** Shortcut for logging notices */
export const notice = _shortcut(Level.NOTICE);
/** Shortcut for logging informational messages */
export const info = _shortcut(Level.INFO);
/** Shortcut for logging debug messages */
export const debug = _shortcut(Level.DEBUG);

/**
 * Shortcut for logging usage of deprecated functions at runtime
 * @param symbol The thing that is deprecated
 * @internal @hidden
 */
export function log_deprecated(symbol: string): void {
	log(Level.WARN, symbol + ' is deprecated and should not be used.');
}

// Formatting and output

function _prettyMs(entry: Entry, ansi: boolean = false) {
	const text = '[' + (entry.elapsedMs / 1000).toFixed(3).padStart(10) + '] ';

	return ansi ? __ansiFormat(text, '2;37') : text;
}

const _ansiLevelColor: Record<Level, string> = {
	[Level.EMERG]: '1;4;37;41',
	[Level.ALERT]: '1;37;41',
	[Level.CRIT]: '1;31',
	[Level.ERR]: '31',
	[Level.WARN]: '33',
	[Level.NOTICE]: '1;37',
	[Level.INFO]: '37',
	[Level.DEBUG]: '2;37',
};

function __ansiFormat(text: string, format: string): string {
	return `\x1b[${format}m${text}\x1b[0m`;
}

const _colorModes = ['ansi:message', 'ansi:level'] as const;
type ColorMode = (typeof _colorModes)[number];

/**
 * @internal @hidden
 */
export function _withColors(mode: ColorMode) {
	if (!_colorModes.includes(mode)) throw new Error('_withColors: Invalid mode');

	switch (mode) {
		case 'ansi:level':
			return function (entry: Entry) {
				const levelText = __ansiFormat(levels[entry.level].toUpperCase(), _ansiLevelColor[entry.level]);
				return [_prettyMs(entry, true), levelText, entry.message].join(' ');
			};
		case 'ansi:message':
			return function (entry: Entry) {
				let msg = _prettyMs(entry, true);

				const isImportant = entry.level < Level.CRIT;

				if (isImportant) msg += __ansiFormat(levels[entry.level].toUpperCase(), _ansiLevelColor[entry.level]) + ': ';

				msg += __ansiFormat(entry.message, _ansiLevelColor[Math.max(entry.level, Level.CRIT) as Level]);

				return msg;
			};
	}
}

let _format: (entry: Entry) => string = (entry: Entry) => {
	return `[${_prettyMs(entry)}] ${entry.message}`;
};

export function format(entry: Entry) {
	return _format(entry);
}

let _output: (message: string) => unknown = console.error;

function output(entry: Entry) {
	if (entry.level > minLevel) return;
	_output(format(entry));
}

let minLevel: Level = Level.ALERT;

// Configuration

/** Whether log entries are being recorded */
export let isEnabled: boolean = true;

export interface LogConfiguration {
	/**
	 * If false, log messages will not be recorded or outputted
	 * @default false
	 */
	enabled?: boolean;

	/**
	 * The minimum level needed to output a message
	 * @default Level.ALERT
	 */
	level?: Level | (typeof levels)[Level];

	/**
	 * Formats a log entry into a string
	 * @default `[${ms / 1000}] ${message}`
	 */
	format?(this: void, entry: Entry): string;

	/**
	 * Outputs a log message
	 * @default console.error()
	 */
	output?(this: void, message: string): unknown;

	/**
	 * If set, output() all current entries after `configure` is done
	 * @default false
	 */
	dumpBacklog?: boolean;
}

/** Configure logging behavior */
export function configure(options: LogConfiguration): void {
	_format = options.format ?? _format;
	_output = options.output ?? _output;
	minLevel = typeof options.level == 'string' ? levelOf(options.level) : (options.level ?? minLevel);
	isEnabled = options.enabled ?? isEnabled;

	if (!options.dumpBacklog) return;

	for (const entry of entries) {
		output(entry);
	}
}
