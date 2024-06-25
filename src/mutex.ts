import { ErrnoError, Errno } from './error.js';

/**
 * Non-recursive mutex
 * @internal
 */
export class Mutex {
	protected locks: Map<string, PromiseWithResolvers<void>> = new Map();

	public async lock(path: string): Promise<void> {
		if (this.locks.has(path)) {
			// Non-null assertion: we already checked locks has path
			await this.locks.get(path)!.promise;
		}

		this.locks.set(path, Promise.withResolvers());
	}

	public unlock(path: string): void {
		if (!this.locks.has(path)) {
			throw new ErrnoError(Errno.EPERM, 'Can not unlock an already unlocked path', path);
		}

		// Non-null assertion: we already checked locks has path
		this.locks.get(path)!.resolve();
	}

	public tryLock(path: string): boolean {
		if (this.locks.has(path)) {
			return false;
		}

		this.locks.set(path, Promise.withResolvers());
		return true;
	}

	public isLocked(path: string): boolean {
		return this.locks.has(path);
	}
}
