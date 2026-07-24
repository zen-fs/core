import { withErrno } from 'kerium';
import { memoize } from 'utilium';

export interface LockRelease extends Disposable {
	(): void;
}

export type LockMode = 'ro' | 'rw';

const enum WriteState {
	Free,
	Async,
	Sync,
}

/**
 * A synchronization primitive for handling concurrent access to a resource that can have multiple readers or an exclusive writer.
 * Modeled after Linux's `rw_semaphore`
 */
export class RwLock {
	/** Release promises for every currently held or queued acquisition */
	protected pending = new Set<Promise<void>>();

	/** This is the *last queued* writer */
	protected lastWriter?: Promise<void>;

	/** The current accepted write state of the lock */
	protected writeState: WriteState = 0;

	/** Number of currently accepted readers */
	protected readers: number = 0;
	protected syncReaders: number = 0;

	/** Actually take the lock */
	protected take(mode: LockMode, sync: boolean, resolve: () => void): LockRelease {
		if (mode == 'rw') {
			this.writeState = sync ? WriteState.Sync : WriteState.Async;
		} else {
			this.readers++;
			if (sync) this.syncReaders++;
		}

		let released = false;
		const release = (): void => {
			if (released) return;
			released = true;

			if (mode == 'rw') {
				this.writeState = 0;
			} else {
				this.readers--;
				if (sync) this.syncReaders--;
			}

			resolve();
		};
		release[Symbol.dispose] = release;
		return release;
	}

	/** Queue the reader or writer */
	protected queue(mode: LockMode): () => void {
		const { promise, resolve } = Promise.withResolvers<void>();
		this.pending.add(promise);
		if (mode == 'rw') this.lastWriter = promise;
		void promise.then(() => {
			this.pending.delete(promise);
			if (this.lastWriter == promise) delete this.lastWriter;
		});
		return resolve;
	}

	/**
	 * Acquire a lock asynchronously
	 */
	async acquire(mode: LockMode): Promise<LockRelease> {
		const allReleased = mode == 'ro' ? this.lastWriter : Promise.all(this.pending);

		const resolve = this.queue(mode);

		await allReleased;

		return this.take(mode, false, resolve);
	}

	/**
	 * Acquire a lock synchronously. Does not support waiting for existing locks.
	 * @throws EDEADLK for rw if there is an existing synchronous holder (it is in the current call chain)
	 * @throws EAGAIN for rw if there is an existing asynchronous holder
	 */
	acquireSync(mode: LockMode): LockRelease {
		if (this.writeState == WriteState.Sync || (mode == 'rw' && this.syncReaders)) throw withErrno('EDEADLK');
		if (this.writeState || (mode == 'rw' && this.readers)) throw withErrno('EAGAIN');

		return this.take(mode, true, this.queue(mode));
	}

	/** Whether a synchronous lock can be acquired for the given mode */
	isAvailable(mode: LockMode): boolean {
		return (mode != 'rw' || !this.readers) && !this.writeState;
	}

	/** Whether the lock is currently free. This value may be invalid after an `await` */
	get isFree(): boolean {
		return !this.writeState && !this.readers;
	}

	/** How the lock is currently being used. This value may be invalid after an `await` */
	get mode(): LockMode | null {
		if (this.writeState) return 'rw';
		if (this.readers) return 'ro';
		return null;
	}
}

export class RwLockable {
	protected _rwLock = new RwLock();

	@memoize
	get lock(): RwLock['acquire'] {
		return this._rwLock.acquire.bind(this._rwLock);
	}

	@memoize
	get lockSync(): RwLock['acquireSync'] {
		return this._rwLock.acquireSync.bind(this._rwLock);
	}

	get isLocked(): boolean {
		return !this._rwLock.isFree;
	}

	get lockMode(): LockMode | null {
		return this._rwLock.mode;
	}
}
