// SPDX-License-Identifier: LGPL-3.0-or-later
import type { EventEmitter as NodeEventEmitter } from 'node:events';
import type * as fs from 'node:fs';
import type { V_Context } from '../context.js';

import { EventEmitter } from 'eventemitter3';
import { UV } from 'kerium';
import { contextOf } from '../internal/contexts.js';
import { isStatsEqual, type Stats } from '../node/stats.js';
import { statSync } from '../node/sync.js';
import { basename, dirname, join, matchesGlob, relative } from '../path.js';
import '../polyfills.js';
import { _describeReceived, normalizePath } from '../utils.js';

/** Alias so `.call` resolves to the non-bigint overload */
const _statSync: (this: V_Context, path: string) => Stats = statSync;

/**
 * Base class for file system watchers.
 * Provides event handling capabilities for watching file system changes.
 *
 * @template TEvents The type of events emitted by the watcher.
 */
class Watcher<TEvents extends Record<string, unknown[]> = Record<string, unknown[]>> extends EventEmitter<TEvents> implements NodeEventEmitter {
	public off<T extends EventEmitter.EventNames<TEvents>>(event: T, fn?: (...args: any[]) => void, context?: any, once?: boolean): this {
		return super.off<T>(event, fn as EventEmitter.EventListener<TEvents, T>, context, once);
	}

	public removeListener<T extends EventEmitter.EventNames<TEvents>>(event: T, fn?: (...args: any[]) => void, context?: any, once?: boolean): this {
		return super.removeListener<T>(event, fn as EventEmitter.EventListener<TEvents, T>, context, once);
	}

	public constructor(
		/**
		 * @internal
		 */
		public readonly _context: V_Context,
		public readonly path: string,
	) {
		super();
	}

	public setMaxListeners(): never {
		throw UV('ENOSYS', 'Watcher.setMaxListeners');
	}

	public getMaxListeners(): never {
		throw UV('ENOSYS', 'Watcher.getMaxListeners');
	}

	public prependListener(): never {
		throw UV('ENOSYS', 'Watcher.prependListener');
	}

	public prependOnceListener(): never {
		throw UV('ENOSYS', 'Watcher.prependOnceListener');
	}

	public rawListeners(): never {
		throw UV('ENOSYS', 'Watcher.rawListeners');
	}

	public ref(): this {
		return this;
	}

	public unref(): this {
		return this;
	}
}

/**
 * Creates a function that determines whether a watcher ignores a filename, validating `ignore` like Node.
 */
function createIgnoreMatcher(ignore: fs.WatchOptions['ignore']): (filename: string) => boolean {
	if (ignore == null) return () => false;

	const isArray = Array.isArray(ignore);
	const matchers = (isArray ? ignore : [ignore]) as readonly unknown[];

	const compiled = matchers.map((matcher, i): ((filename: string) => boolean) => {
		const name = isArray ? `options.ignore[${i}]` : 'options.ignore';

		if (typeof matcher == 'string') {
			if (!matcher.length)
				throw Object.assign(new TypeError(`The property '${name}' must be a non-empty string. Received ''`), {
					code: 'ERR_INVALID_ARG_VALUE',
				});
			return filename => matchesGlob(matcher.includes('/') ? filename : basename(filename), matcher);
		}

		if (matcher instanceof RegExp) return filename => matcher.test(filename);
		if (typeof matcher == 'function') return matcher as (filename: string) => boolean;

		throw Object.assign(
			new TypeError(
				`The "${name}" property must be one of type string or function or an instance of RegExp. Received ${_describeReceived(matcher)}`,
			),
			{ code: 'ERR_INVALID_ARG_TYPE' },
		);
	});

	return filename => compiled.some(matches => matches(filename));
}

/**
 * Watches for changes on the file system.
 *
 * @template T The type of the filename, either `string` or `Buffer`.
 */
export class FSWatcher<T extends string | Buffer = string | Buffer>
	extends Watcher<{
		change: [eventType: fs.WatchEventType, filename: T];
		close: [];
		error: [error: Error];
	}>
	implements fs.FSWatcher
{
	protected readonly realpath: string;

	/** @internal */
	public readonly ignores: (filename: string) => boolean;

	public constructor(
		context: V_Context,
		path: string,
		public readonly options: fs.WatchOptions,
	) {
		const $ = contextOf(context);

		super($, path);

		this.ignores = createIgnoreMatcher(options.ignore);
		this.realpath = join($.root, path);

		addWatcher(this.realpath, this);
	}

	public close(): void {
		super.emit('close');
		removeWatcher(this.realpath, this);
	}

	public [Symbol.dispose](): void {
		this.close();
	}
}

/**
 * Watches for changes to a file's stats.
 *
 * Instances of `StatWatcher` are used by `fs.watchFile()` to monitor changes to a file's statistics.
 */
export class StatWatcher
	extends Watcher<{
		change: [current: Stats, previous: Stats];
		close: [];
		error: [error: Error];
	}>
	implements fs.StatWatcher
{
	private intervalId?: NodeJS.Timeout | number;
	private previous?: Stats;

	public constructor(
		context: V_Context,
		path: string,
		private options: { persistent?: boolean; interval?: number },
	) {
		super(context, path);
		this.start();
	}

	protected onInterval() {
		try {
			const current = _statSync.call(this._context, this.path);
			if (!isStatsEqual(this.previous!, current)) {
				this.emit('change', current, this.previous!);
				this.previous = current;
			}
		} catch (e) {
			this.emit('error', e as Error);
		}
	}

	protected start() {
		const interval = this.options.interval || 5000;
		try {
			this.previous = _statSync.call(this._context, this.path);
		} catch (e) {
			this.emit('error', e as Error);
			return;
		}
		this.intervalId = setInterval(this.onInterval.bind(this), interval);
		if (!this.options.persistent && typeof this.intervalId == 'object') {
			this.intervalId.unref();
		}
	}

	/**
	 * @internal
	 */
	public stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
		this.removeAllListeners();
	}
}

const watchers: Map<string, Set<FSWatcher>> = new Map();

export function addWatcher(path: string, watcher: FSWatcher) {
	const normalizedPath = normalizePath(path);
	watchers.getOrInsertComputed(normalizedPath, () => new Set()).add(watcher);
}

export function removeWatcher(path: string, watcher: FSWatcher) {
	const normalizedPath = normalizePath(path);
	if (watchers.has(normalizedPath)) {
		watchers.get(normalizedPath)!.delete(watcher);
		if (watchers.get(normalizedPath)!.size === 0) {
			watchers.delete(normalizedPath);
		}
	}
}

/**
 * @internal @hidden
 */
export function emitChange(context: V_Context, eventType: fs.WatchEventType, filename: string) {
	const $ = contextOf(context);

	if ($) filename = join($.root ?? '/', filename);
	filename = normalizePath.call(context, filename);

	// Notify watchers of the file and its directory, and ones on further ancestors if they are watching recursively.
	for (let path = filename; ; path = dirname(path)) {
		const watchersForPath = watchers.get(path);
		const isNested = path != filename && path != dirname(filename);

		if (watchersForPath) {
			for (const watcher of watchersForPath) {
				if (isNested && !watcher.options.recursive) continue;
				const name = relative.call(watcher._context, path, filename) || basename(filename);
				if (watcher.ignores(name)) continue;
				watcher.emit('change', eventType, name);
			}
		}

		if (path === '/') break;
	}
}
