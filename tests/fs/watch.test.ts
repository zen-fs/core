// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Stats } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const testDir = '/test-watch-dir';
const testFile = testDir + '/test.txt';

await fs.promises.mkdir(testDir);
await fs.promises.writeFile(testFile, 'Initial content');

/** Fail instead of hanging the suite if an expected event is never emitted */
async function withTimeout<T>(promise: Promise<T>, ms: number = 1000): Promise<T> {
	const { promise: timedOut, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms waiting for an event`)), ms);
	timer.unref?.();
	try {
		return await Promise.race([promise, timedOut]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * @todo convert `using watcher = ...` to void discards pending ES proposal
 */
suite('Watch', () => {
	test('Events emitted on file change', async () => {
		const { promise, resolve } = Promise.withResolvers<[string, string]>();

		using watcher = fs.watch(testFile, (eventType, filename) => {
			resolve([eventType, filename]);
		});

		// Modify the file to trigger the event
		await fs.promises.writeFile(testFile, 'Updated content');

		const [eventType, filename] = await withTimeout(promise);
		assert.equal(eventType, 'change');
		assert.equal(filename, 'test.txt');
	});

	test('Events are emitted on delete', async () => {
		const { promise, resolve } = Promise.withResolvers<[string, string]>();

		using watcher = fs.watch(testFile, (eventType, filename) => {
			resolve([eventType, filename]);
		});

		// Delete the file to trigger the event
		await fs.promises.unlink(testFile);

		const [eventType, filename] = await withTimeout(promise);
		assert.equal(eventType, 'rename');
		assert.equal(filename, 'test.txt');
	});

	test('Changes are detected with watchFile()', async () => {
		// The previous test deleted the file, and watching a non-existent file is its own can of worms
		await fs.promises.writeFile(testFile, 'Restored');

		const { promise, resolve } = Promise.withResolvers<[Stats, Stats]>();
		const listener = (curr: Stats, prev: Stats) => resolve([curr, prev]);

		fs.watchFile(testFile, { interval: 50 }, listener);

		try {
			// Modify the file to trigger the event
			await fs.promises.writeFile(testFile, 'Changed content');

			const [curr, prev] = await withTimeout(promise, 2000);
			assert(curr.mtimeMs != prev.mtimeMs);
		} finally {
			fs.unwatchFile(testFile, listener);
		}
	});

	test('unwatchFile() works', async () => {
		let changeDetected = false;

		const listener = () => {
			changeDetected = true;
		};

		fs.watchFile(testFile, listener);
		fs.unwatchFile(testFile, listener);

		// Modify the file to see if the listener is called
		await fs.promises.writeFile(testFile, 'Another change');

		// Wait to see if any change is detected
		assert(!changeDetected);
	});

	test('Directories can be watched', async () => {
		const { promise, resolve } = Promise.withResolvers<[string, string]>();

		using watcher = fs.watch(testDir, (eventType, filename) => {
			resolve([eventType, filename]);
		});

		await fs.promises.writeFile(testDir + '/newFile.txt', 'Content');

		const [eventType, filename] = await withTimeout(promise);
		assert.equal(eventType, 'change');
		assert.equal(filename, 'newFile.txt');
	});

	test('File renames are detected', async () => {
		const oldFileName = 'oldFile.txt';
		const newFileName = 'newFile.txt';
		const oldFile = testDir + '/' + oldFileName;
		const newFile = testDir + '/' + newFileName;

		await fs.promises.writeFile(oldFile, 'Some content');

		const events: Record<string, string> = {};
		const { promise, resolve } = Promise.withResolvers<void>();

		using watcher = fs.watch(testDir, (eventType, filename) => {
			events[filename] ??= eventType;
			if (oldFileName in events && newFileName in events) resolve();
		});

		// Rename the file to trigger the events
		await fs.promises.rename(oldFile, newFile);

		await withTimeout(promise);
		assert.equal(events[oldFileName], 'rename');
		assert.equal(events[newFileName], 'change');
	});

	test('File deletions are detected', async () => {
		const tempFile = `${testDir}/tempFile.txt`;

		await fs.promises.writeFile(tempFile, 'Temporary content');

		const { promise, resolve } = Promise.withResolvers<[string, string]>();

		using watcher = fs.watch(tempFile, (eventType, filename) => {
			resolve([eventType, filename]);
		});

		await fs.promises.unlink(tempFile);

		const [eventType, filename] = await withTimeout(promise);
		assert.equal(eventType, 'rename');
		assert.equal(filename, 'tempFile.txt');
	});

	test('File deletions are detected by promises API', async () => {
		const tempFile = `${testDir}/tempFile.txt`;

		await fs.promises.writeFile(tempFile, 'Temporary content');

		const ac = new AbortController();
		const watcher = fs.promises.watch(tempFile, { signal: ac.signal });

		const promise = (async () => {
			for await (const event of watcher) return event;
		})().catch((e: Error) => {
			if (e.name != 'AbortError') throw e;
		});

		try {
			await fs.promises.unlink(tempFile);

			const event = await withTimeout(promise);
			assert.equal(event?.eventType, 'rename');
			assert.equal(event?.filename, 'tempFile.txt');
		} finally {
			// Close the watcher both ways, since ZenFS exposes return() and native fs uses the signal
			await watcher.return?.();
			ac.abort();
		}
	});

	test('File creations are detected recursively', async () => {
		const subDir = `${testDir}/sub-dir`;
		const tempFile = `${subDir}/tempFile.txt`;
		await fs.promises.mkdir(subDir);

		const ac = new AbortController();
		const watcher = fs.promises.watch('/', { signal: ac.signal });

		// Write before consuming the iterator, so the first received event is for the unlink
		await fs.promises.writeFile(tempFile, 'Temporary content');

		const promise = (async () => {
			for await (const event of watcher) return event;
		})().catch((e: Error) => {
			if (e.name != 'AbortError') throw e;
		});

		try {
			await fs.promises.unlink(tempFile);

			const event = await withTimeout(promise);
			assert.equal(event?.eventType, 'rename');
			assert.equal(event?.filename, tempFile.slice(1));
		} finally {
			// Close the watcher both ways, since ZenFS exposes return() and native fs uses the signal
			await watcher.return?.();
			ac.abort();
		}
	});

	test('watch("/") receives events for files under root #293', async () => {
		// Regression: emitChange previously exited its parent-walk before
		// checking watchers.get('/'), so a watcher registered on '/' never fired.
		const { promise, resolve } = Promise.withResolvers<[string, string]>();

		using watcher = fs.watch('/', (eventType, filename) => {
			resolve([eventType, filename]);
		});

		await fs.promises.writeFile('/watch-root-file.txt', 'x');

		const [eventType, filename] = await withTimeout(promise);
		assert.equal(eventType, 'change');
		assert.equal(filename, 'watch-root-file.txt');
	});
});
