import { Errno, ErrnoError } from './error.js';

/**
 * Non-recursive mutex
 * @internal
 */
export class Mutex {
	protected locks: Map<string, [PromiseWithResolvers<void>]> = new Map();

	public async lock(path: string): Promise<void> {
		if (this.locks.has(path)) {
			// Non-null assertion: we already checked locks has path
			const promise = this.locks.get(path)!.at(-1);
			this.locks.get(path)!.push(Promise.withResolvers());
			await promise;
		} else {
			this.locks.set(path, [Promise.withResolvers()]);
		}
	}

	/**
	 * Unlocks a path
	 * @param path The path to lock
	 * @param noThrow If true, an error will not be thrown if the path is already unlocked
	 * @returns Whether the path was unlocked
	 */
	public unlock(path: string, noThrow: boolean = false): boolean {
		if (!this.locks.has(path)) {
			if (noThrow) {
				return false;
			}
			throw new ErrnoError(Errno.EPERM, 'Can not unlock an already unlocked path', path);
		}

		// Non-null assertion: we already checked locks has path
		const res = this.locks.get(path)!.shift();
		res!.resolve();
		return true;
	}

	public tryLock(path: string): boolean {
		if (this.locks.has(path) && this.locks.get(path)!.length > 0) {
			return false;
		}

		this.locks.set(path, [Promise.withResolvers()]);
		return true;
	}

	public isLocked(path: string): boolean {
		return this.locks.has(path) && this.locks.get(path)!.length > 0;
	}
}
