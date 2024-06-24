import { Mutex } from '../../src/mutex.js';

describe('Test Mutex', () => {
	let mutex: Mutex;

	beforeEach(() => {
		mutex = new Mutex();
	});

	test('Test lock', async () => {
		await mutex.lock('testLock');
		mutex.unlock('testLock');
	});

	test('queueing locks', async () => {
		let lock1Resolved = false;
		let lock2Resolved = false;

		const lock1 = mutex.lock('queueingLocks').then(() => {
			lock1Resolved = true;
		});
		const lock2 = mutex.lock('queueingLocks').then(() => {
			lock2Resolved = true;
		});

		expect(lock1Resolved).toBe(false);
		expect(lock2Resolved).toBe(false);

		mutex.unlock('queueingLocks');
		await lock1;

		expect(lock1Resolved).toBe(true);
		expect(lock2Resolved).toBe(false);

		mutex.unlock('queueingLocks');
		await lock2;

		expect(lock1Resolved).toBe(true);
		expect(lock2Resolved).toBe(true);
	});

	test('test race conditions', async () => {
		let x = 1;

		async function foo() {
			await mutex.lock('raceConditions');
			let y = x;
			await new Promise(resolve => setTimeout(resolve, 100));
			x = y + 1;
			mutex.unlock('raceConditions');
		}

		await Promise.all([foo(), foo(), foo()]);
		expect(x).toBe(4);
	});

	test('Unlock without lock', async () => {
		const mutex = new Mutex();
		const unlock = () => mutex.unlock('unlockWithoutLock');

		expect(unlock).toThrowError();
	});
});
