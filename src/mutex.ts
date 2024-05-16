import { ErrnoError, Errno } from './error.js';

/**
 * Non-recursive mutex
 * @internal
 */
export class Mutex {
	protected locks: Map<string, (() => void)[]> = new Map();

	public lock(path: string): Promise<void> {
		return new Promise(resolve => {
			if (this.locks.has(path)) {
				this.locks.get(path)!.push(resolve);
			} else {
				this.locks.set(path, [resolve]);
			}
		});
	}

	public unlock(path: string): void {
		if (!this.locks.has(path)) {
			throw new ErrnoError(Errno.EPERM, 'Can not unlock an already unlocked path', path);
		}

		const next = this.locks.get(path)?.shift();
		/* 
			don't unlock - we want to queue up next for the
			end of the current task execution, but we don't
			want it to be called inline with whatever the
			current stack is.  This way we still get the nice
			behavior that an unlock immediately followed by a
			lock won't cause starvation.
		*/
		if (next) {
			setTimeout(next);
			return;
		}

		this.locks.delete(path);
	}

	public tryLock(path: string): boolean {
		if (this.locks.has(path)) {
			return false;
		}

		this.locks.set(path, []);
		return true;
	}

	public isLocked(path: string): boolean {
		return this.locks.has(path);
	}
}
