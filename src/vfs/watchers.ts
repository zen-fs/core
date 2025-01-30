import type { EventEmitter as NodeEventEmitter } from 'node:events';
import type * as fs from 'node:fs';
import type { V_Context } from '../context.js';

import { EventEmitter } from 'eventemitter3';
import { ErrnoError } from '../internal/error.js';
import { isStatsEqual, type Stats } from '../stats.js';
import { normalizePath } from '../utils.js';
import { basename, dirname, join } from './path.js';
import { statSync } from './sync.js';

/**
 * Base class for file system watchers.
 * Provides event handling capabilities for watching file system changes.
 *
 * @template TEvents The type of events emitted by the watcher.
 */
class Watcher<TEvents extends Record<string, unknown[]> = Record<string, unknown[]>> extends EventEmitter<TEvents> implements NodeEventEmitter {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	public off<T extends EventEmitter.EventNames<TEvents>>(event: T, fn?: (...args: any[]) => void, context?: any, once?: boolean): this {
		return super.off<T>(event, fn as EventEmitter.EventListener<TEvents, T>, context, once);
	}

	public removeListener<T extends EventEmitter.EventNames<TEvents>>(event: T, fn?: (...args: any[]) => void, context?: any, once?: boolean): this {
		return super.removeListener<T>(event, fn as EventEmitter.EventListener<TEvents, T>, context, once);
	}
	/* eslint-enable @typescript-eslint/no-explicit-any */

	public constructor(
		/**
		 * @internal
		 */
		public readonly _context: V_Context,
		public readonly path: string
	) {
		super();
	}

	public setMaxListeners(): never {
		throw ErrnoError.With('ENOSYS', this.path, 'Watcher.setMaxListeners');
	}

	public getMaxListeners(): never {
		throw ErrnoError.With('ENOSYS', this.path, 'Watcher.getMaxListeners');
	}

	public prependListener(): never {
		throw ErrnoError.With('ENOSYS', this.path, 'Watcher.prependListener');
	}

	public prependOnceListener(): never {
		throw ErrnoError.With('ENOSYS', this.path, 'Watcher.prependOnceListener');
	}

	public rawListeners(): never {
		throw ErrnoError.With('ENOSYS', this.path, 'Watcher.rawListeners');
	}

	public ref(): this {
		return this;
	}

	public unref(): this {
		return this;
	}
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
	public constructor(
		context: V_Context,
		path: string,
		public readonly options: fs.WatchOptions
	) {
		super(context, path);
		addWatcher(path.toString(), this);
	}

	public close(): void {
		super.emit('close');
		removeWatcher(this.path.toString(), this);
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
		private options: { persistent?: boolean; interval?: number }
	) {
		super(context, path);
		this.start();
	}

	protected onInterval() {
		try {
			const current = statSync(this.path);
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
			this.previous = statSync(this.path);
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
	if (!watchers.has(normalizedPath)) {
		watchers.set(normalizedPath, new Set());
	}
	watchers.get(normalizedPath)!.add(watcher);
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
	if (context) filename = join(context.root ?? '/', filename);
	filename = normalizePath(filename);
	// Notify watchers on the specific file
	if (watchers.has(filename)) {
		for (const watcher of watchers.get(filename)!) {
			watcher.emit('change', eventType, basename(filename));
		}
	}

	// Notify watchers on parent directories if they are watching recursively
	let parent = filename,
		normalizedFilename;
	while (parent !== normalizedFilename) {
		normalizedFilename = parent;
		parent = dirname(parent);

		const parentWatchers = watchers.get(parent);

		if (!parentWatchers) continue;

		for (const watcher of parentWatchers) {
			// Strip the context root from the path if the watcher has a context

			const root = watcher._context?.root;
			const contextPath = root && filename.startsWith(root) ? filename.slice(root.length) : filename;
			const relativePath = contextPath.slice(parent.length + (parent == '/' ? 0 : 1));

			watcher.emit('change', eventType, relativePath);
		}
	}
}
