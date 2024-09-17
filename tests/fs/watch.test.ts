import { fs } from '../common.js';

const testDir = '/test-watch-dir';
const testFile = `${testDir}/test.txt`;

describe('Watch Features', () => {
	beforeAll(async () => {
		// Set up test directory and file
		try {
			await fs.promises.mkdir(testDir);
		} catch (err) {
			// Directory might already exist
		}
		await fs.promises.writeFile(testFile, 'Initial content');
	});

	afterAll(async () => {
		// Clean up test directory and file
		try {
			await fs.promises.unlink(testFile);
		} catch (err) {
			// File might already be deleted
		}
		try {
			await fs.promises.rmdir(testDir);
		} catch (err) {
			// Directory might already be deleted
		}
	});

	test('fs.watch should emit events on file change', async () => {
		using watcher = fs.watch(testFile, (eventType, filename) => {
			expect(eventType).toBe('change');
			expect(filename).toBe('test.txt');
		});

		// Modify the file to trigger the event
		await fs.promises.writeFile(testFile, 'Updated content');
	});

	test('fs.watch should emit events on file rename (delete)', async () => {
		using watcher = fs.watch(testFile, (eventType, filename) => {
			expect(eventType).toBe('rename');
			expect(filename).toBe('test.txt');
		});

		// Delete the file to trigger the event
		await fs.promises.unlink(testFile);
	});

	test('fs.watchFile should detect changes to a file', async () => {
		const listener = (curr: fs.Stats, prev: fs.Stats) => {
			expect(curr.mtimeMs).not.toBe(prev.mtimeMs);
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
		expect(changeDetected).toBe(false);
	});

	test('fs.watch should work with directories', async () => {
		using watcher = fs.watch(testDir, (eventType, filename) => {
			expect(eventType).toBe('change');
			expect(filename).toBe('newFile.txt');
		});

		await fs.promises.writeFile(`${testDir}/newFile.txt`, 'Content');
	});

	test('fs.watch should detect file renames', async () => {
		const oldFile = `${testDir}/oldFile.txt`;
		const newFile = `${testDir}/newFile.txt`;

		await fs.promises.writeFile(oldFile, 'Some content');

		using watcher = fs.watch(testDir, (eventType, filename) => {
			expect(eventType).toBe('rename');
			expect(filename).toBe('oldFile.txt');
		});

		// Rename the file to trigger the event
		await fs.promises.rename(oldFile, newFile);
	});

	test('fs.watch should detect file deletions', async () => {
		const tempFile = `${testDir}/tempFile.txt`;

		await fs.promises.writeFile(tempFile, 'Temporary content');

		using watcher = fs.watch(tempFile, (eventType, filename) => {
			expect(eventType).toBe('rename');
			expect(filename).toBe('tempFile.txt');
		});

		await fs.promises.unlink(tempFile);
	});
});
