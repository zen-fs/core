import { ErrnoError, Errno } from './error.js';

/**
 * Non-recursive mutex
 * @internal
 */
export class Mutex {
	protected locks: Map<string, { isLocked: boolean; queue: (() => void)[] }> = new Map();

	public lock(path: string): Promise<void> {
		if (!this.locks.has(path)) {
			this.locks.set(path, { isLocked: false, queue: [] });
		}
		const queue = this.locks.get(path);

		return new Promise(resolve => {
			queue!.queue.push(resolve);
			this.dispatch(path);
		});
	}

	public unlock(path: string): void {
		if (!this.locks.has(path)) {
			throw new ErrnoError(Errno.EPERM, 'Can not unlock an already unlocked path', path);
		}
		this.locks.get(path)!.isLocked = false;
		/* 
			don't unlock - we want to queue up next for the
			end of the current task execution, but we don't
			want it to be called inline with whatever the
			current stack is.  This way we still get the nice
			behavior that an unlock immediately followed by a
			lock won't cause starvation.
		*/
		setTimeout(() => this.dispatch(path));
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

	private dispatch(path: string) {
		const queue = this.locks.get(path);
		if (queue!.isLocked) {
			return;
		}

		const next = queue!.queue.shift();
		if (!next) {
			return;
		}

		queue!.isLocked = true;
		next();
	}
}
