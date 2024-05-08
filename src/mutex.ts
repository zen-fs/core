import { ErrnoError, Errno } from './error.js';

/**
 * Non-recursive mutex
 * @internal
 */
export class Mutex {
	private _locks: Map<string, (() => void)[]> = new Map();

	public lock(path: string): Promise<void> {
		return new Promise(resolve => {
			if (this._locks.has(path)) {
				this._locks.get(path)!.push(resolve);
			} else {
				this._locks.set(path, [resolve]);
			}
		});
	}

	public unlock(path: string): void {
		if (!this._locks.has(path)) {
			throw new ErrnoError(Errno.EPERM, 'Can not unlock an already unlocked path', path);
		}

		const next = this._locks.get(path)?.shift();
		/* 
			don't unlock - we want to queue up next for the
			end of the current task execution, but we don't
			want it to be called inline with whatever the
			current stack is.  This way we still get the nice
			behavior that an unlock immediately followed by a
			lock won't cause starvation.
		*/
		if (next) {
			setTimeout(next, 0);
			return;
		}

		this._locks.delete(path);
	}

	public tryLock(path: string): boolean {
		if (this._locks.has(path)) {
			return false;
		}

		this._locks.set(path, []);
		return true;
	}

	public isLocked(path: string): boolean {
		return this._locks.has(path);
	}
}
