import { EventEmitter } from 'eventemitter3';
import type { EventEmitter as NodeEventEmitter } from 'node:events';
import type * as fs from 'node:fs';
import { ErrnoError } from '../error.js';

class Watcher<TEvents extends Record<string, unknown[]> = Record<string, unknown[]>> extends EventEmitter<TEvents> implements NodeEventEmitter {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	public off<T extends EventEmitter.EventNames<TEvents>>(event: T, fn?: ((...args: any[]) => void) | undefined, context?: any, once?: boolean | undefined): this {
		return super.off<T>(event, fn as EventEmitter.EventListener<TEvents, T>, context, once);
	}

	public removeListener<T extends EventEmitter.EventNames<TEvents>>(event: T, fn?: ((...args: any[]) => void) | undefined, context?: any, once?: boolean | undefined): this {
		return super.removeListener<T>(event, fn as EventEmitter.EventListener<TEvents, T>, context, once);
	}
	/* eslint-enable @typescript-eslint/no-explicit-any */

	public setMaxListeners(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	public getMaxListeners(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	public prependListener(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	public prependOnceListener(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	public rawListeners(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	public ref(): this {
		return this;
	}

	public unref(): this {
		return this;
	}
}

export class FSWatcher
	extends Watcher<{
		change: [eventType: string, filename: string | Buffer];
		close: [];
		error: [error: Error];
	}>
	implements fs.FSWatcher
{
	public close(): void {}
}

export class StatWatcher extends Watcher implements fs.StatWatcher {}
