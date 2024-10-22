import assert from 'node:assert';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const testDir = '/test-watch-dir';
const testFile = `${testDir}/test.txt`;

await fs.promises.mkdir(testDir);
await fs.promises.writeFile(testFile, 'Initial content');

/**
 * @todo convert using watcher to void discards pending ES proposal
 */
suite('Watch Features', () => {
	test('fs.watch should emit events on file change', async () => {
		using watcher = fs.watch(testFile, (eventType, filename) => {
			assert(eventType === 'change');
			assert(filename === 'test.txt');
		});

		// Modify the file to trigger the event
		await fs.promises.writeFile(testFile, 'Updated content');
	});

	test('fs.watch should emit events on file rename (delete)', async () => {
		using watcher = fs.watch(testFile, (eventType, filename) => {
			assert(eventType === 'rename');
			assert(filename === 'test.txt');
		});

		// Delete the file to trigger the event
		await fs.promises.unlink(testFile);
	});

	test('fs.watchFile should detect changes to a file', async () => {
		const listener = (curr: fs.Stats, prev: fs.Stats) => {
			assert(curr.mtimeMs != prev.mtimeMs);
			fs.unwatchFile(testFile, listener);
		};

		fs.watchFile(testFile, listener);

		// Modify the file to trigger the event
		await fs.promises.writeFile(testFile, 'Changed content');
	});

	test('fs.unwatchFile should stop watching the file', async () => {
		let changeDetected = false;

		const listener = (curr: fs.Stats, prev: fs.Stats) => {
			changeDetected = true;
		};

		fs.watchFile(testFile, listener);
		fs.unwatchFile(testFile, listener);

		// Modify the file to see if the listener is called
		await fs.promises.writeFile(testFile, 'Another change');

		// Wait to see if any change is detected
		assert(!changeDetected);
	});

	test('fs.watch should work with directories', async () => {
		using watcher = fs.watch(testDir, (eventType, filename) => {
			assert(eventType === 'change');
			assert(filename === 'newFile.txt');
		});

		await fs.promises.writeFile(`${testDir}/newFile.txt`, 'Content');
	});

	test('fs.watch should detect file renames', async () => {
		const oldFile = `${testDir}/oldFile.txt`;
		const newFile = `${testDir}/newFile.txt`;

		await fs.promises.writeFile(oldFile, 'Some content');

		using watcher = fs.watch(testDir, (eventType, filename) => {
			assert(eventType === 'rename');
			assert(filename === 'oldFile.txt');
		});

		// Rename the file to trigger the event
		await fs.promises.rename(oldFile, newFile);
	});

	test('fs.watch should detect file deletions', async () => {
		const tempFile = `${testDir}/tempFile.txt`;

		await fs.promises.writeFile(tempFile, 'Temporary content');

		using watcher = fs.watch(tempFile, (eventType, filename) => {
			assert(eventType === 'rename');
			assert(filename === 'tempFile.txt');
		});

		await fs.promises.unlink(tempFile);
	});

	test('fs.promises.watch should detect file deletions', async () => {
		const tempFile = `${testDir}/tempFile.txt`;

		await fs.promises.writeFile(tempFile, 'Temporary content');

		const watcher = fs.promises.watch(tempFile);

		const finished = Promise.withResolvers<void>();
		(async () => {
			for await (const event of watcher) {
				assert(event.eventType === 'rename');
				assert(event.filename === 'tempFile.txt');
				break;
			}
			finished.resolve();
		})();

		await fs.promises.unlink(tempFile);
		await finished.promise;
	});
}).then(async () => {
	await fs.promises.rm(testFile);
	await fs.promises.rm(testDir, { recursive: true, force: true });
});
