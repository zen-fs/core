import { ErrnoError, Errno } from './error.js';
/**
 * Non-recursive mutex
 * @internal
 */
export class Mutex {
	protected locks: Map<string, { isLocked: boolean; queue: (() => void)[] }> = new Map();

	public lock(path: string): Promise<void> {
		return new Promise(resolve => {
			if (!this.locks.has(path)) {
				this.locks.set(path, { isLocked: false, queue: [] });
			}
			const entry = this.locks.get(path);

			if (entry!.isLocked) {
				entry!.queue.push(resolve);
			} else {
				entry!.isLocked = true;
				resolve();
			}
		});
	}

	public unlock(path: string): void {
		const entry = this.locks.get(path);
		if (!entry) {
			throw new ErrnoError(Errno.EPERM, 'Can not unlock an already unlocked path', path);
		}
		if (!entry || entry.queue.length === 0) {
			entry!.isLocked = false;
		} else {
			const resolve = entry.queue.shift();
			/* 
        don't unlock - we want to queue up next for the
        end of the current task execution, but we don't
        want it to be called inline with whatever the
        current stack is.  This way we still get the nice
        behavior that an unlock immediately followed by a
        lock won't cause starvation.
      */
			setTimeout(() => resolve!());
		}
	}

	public tryLock(path: string): boolean {
		if (this.locks.has(path)) {
			return false;
		}

		this.locks.set(path, { isLocked: false, queue: [] });
		return true;
	}

	public isLocked(path: string): boolean {
		return this.locks.has(path);
	}
}
