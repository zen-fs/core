import { wait } from 'utilium';
import { InMemory } from '../src/backends/memory.js';
import { LockedFS } from '../src/backends/locked.js';

describe('LockFS mutex', () => {

	const fs = new LockedFS(InMemory.create({ name: 'test' }));

	test('lock/unlock', () => {
		fs.lockSync('/test');
		fs.unlock('/test');
	});

	test('queueing multiple locks', async () => {
		let lock1Resolved = false;
		let lock2Resolved = false;

		const lock1 = fs.lock('/queued').then(() => {
			lock1Resolved = true;
		});
		const lock2 = fs.lock('/queued').then(() => {
			lock2Resolved = true;
		});

		expect(lock1Resolved).toBe(false);
		expect(lock2Resolved).toBe(false);

		fs.unlock('/queued');
		await lock1;

		expect(lock1Resolved).toBe(true);
		expect(lock2Resolved).toBe(false);

		fs.unlock('/queued');
		await lock2;

		expect(lock1Resolved).toBe(true);
		expect(lock2Resolved).toBe(true);
	});

	test('test race conditions', async () => {
		let x = 1;

		async function foo() {
			await fs.lock('raceConditions');
			await wait(100);
			x++;
			fs.unlock('raceConditions', true);
		}

		await Promise.all([foo(), foo(), foo()]);
		expect(x).toBe(4);
	});

	test('Unlock without lock', async () => {
		expect(() => fs.unlock('unlockWithoutLock')).toThrowError();
	});
});
