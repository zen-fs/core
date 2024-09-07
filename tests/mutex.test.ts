import { wait } from 'utilium';
import { Mutexed } from '../src/mixins/mutexed.js';
import { StoreFS } from '../src/backends/store/fs.js';
import { InMemoryStore } from '../src/backends/memory.js';

describe('LockFS mutex', () => {
	const fs = new (Mutexed(StoreFS))(new InMemoryStore('test'));
	fs.checkRootSync();

	test('lock/unlock', () => {
		const lock = fs.lockSync('/test');
		expect(fs.isLocked('/test')).toBe(true);
		lock.unlock();
		expect(fs.isLocked('/test')).toBe(false);
	});

	test('queueing multiple locks', async () => {
		let lock1Resolved = false;
		let lock2Resolved = false;

		const lock1 = fs.lock('/queued').then(lock => {
			lock1Resolved = true;
			lock.unlock();
		});
		const lock2 = fs.lock('/queued').then(lock => {
			lock2Resolved = true;
			lock.unlock();
		});

		// Both locks are queued, so neither should be resolved initially
		expect(lock1Resolved).toBe(false);
		expect(lock2Resolved).toBe(false);

		// Wait for the first lock to be resolved
		await lock1;

		expect(lock1Resolved).toBe(true);
		expect(lock2Resolved).toBe(false);

		// Wait for the second lock to be resolved
		await lock2;

		expect(lock1Resolved).toBe(true);
		expect(lock2Resolved).toBe(true);
	});

	test('test race conditions', async () => {
		let x = 1;

		async function foo() {
			const lock = await fs.lock('raceConditions');
			await wait(100);
			x++;
			lock.unlock();
		}

		await Promise.all([foo(), foo(), foo()]);
		expect(x).toBe(4);
	});
});
