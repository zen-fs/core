import assert from 'node:assert';
import { suite, test } from 'node:test';
import { fs, type Stats } from '../common.js';

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
			assert.strictEqual(eventType, 'change');
			assert.strictEqual(filename, 'test.txt');
		});

		// Modify the file to trigger the event
		await fs.promises.writeFile(testFile, 'Updated content');
	});

	test('fs.watch should emit events on file rename (delete)', async () => {
		using watcher = fs.watch(testFile, (eventType, filename) => {
			assert.strictEqual(eventType, 'rename');
			assert.strictEqual(filename, 'test.txt');
		});

		// Delete the file to trigger the event
		await fs.promises.unlink(testFile);
	});

	test('fs.watchFile should detect changes to a file', async () => {
		const listener = (curr: Stats, prev: Stats) => {
			assert(curr.mtimeMs != prev.mtimeMs);
			fs.unwatchFile(testFile, listener);
		};

		fs.watchFile(testFile, listener);

		// Modify the file to trigger the event
		await fs.promises.writeFile(testFile, 'Changed content');
	});

	test('fs.unwatchFile should stop watching the file', async () => {
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

	test('fs.watch should work with directories', async () => {
		using watcher = fs.watch(testDir, (eventType, filename) => {
			assert.strictEqual(eventType, 'change');
			assert.strictEqual(filename, 'newFile.txt');
		});

		await fs.promises.writeFile(`${testDir}/newFile.txt`, 'Content');
	});

	test('fs.watch should detect file renames', async () => {
		const oldFileName = `oldFile.txt`;
		const newFileName = `newFile.txt`;
		const oldFile = `${testDir}/${oldFileName}`;
		const newFile = `${testDir}/${newFileName}`;

		await fs.promises.writeFile(oldFile, 'Some content');
		const oldFileResolver = Promise.withResolvers<void>();
		const newFileResolver = Promise.withResolvers<void>();

		const fileResolvers: Record<string, { resolver: PromiseWithResolvers<void>; eventType: string }> = {
			[oldFileName]: { resolver: oldFileResolver, eventType: 'rename' },
			[newFileName]: { resolver: newFileResolver, eventType: 'change' },
		};
		using watcher = fs.watch(testDir, (eventType, filename) => {
			const resolver = fileResolvers[filename];
			assert.notEqual(resolver, undefined); // should have a resolver so file is expected
			assert.strictEqual(eventType, resolver.eventType);
			resolver.resolver.resolve();
		});

		// Rename the file to trigger the event
		await fs.promises.rename(oldFile, newFile);
		await Promise.all([newFileResolver.promise, oldFileResolver.promise]);
	});

	test('fs.watch should detect file deletions', async () => {
		const tempFile = `${testDir}/tempFile.txt`;

		await fs.promises.writeFile(tempFile, 'Temporary content');

		using watcher = fs.watch(tempFile, (eventType, filename) => {
			assert.strictEqual(eventType, 'rename');
			assert.strictEqual(filename, 'tempFile.txt');
		});

		await fs.promises.unlink(tempFile);
	});

	test('fs.promises.watch should detect file deletions', async () => {
		const tempFile = `${testDir}/tempFile.txt`;

		await fs.promises.writeFile(tempFile, 'Temporary content');

		const watcher = fs.promises.watch(tempFile);

		const { promise, resolve } = Promise.withResolvers<void>();
		(async () => {
			for await (const event of watcher) {
				assert.equal(event.eventType, 'rename');
				assert.equal(event.filename, 'tempFile.txt');
				break;
			}
			resolve();
		})();

		await fs.promises.unlink(tempFile);
		await promise;
	});
	test('fs.promises.watch should detect file creations recursively', async () => {
		const rootDir = '/';
		const subDir = `${testDir}sub-dir`;
		const tempFile = `${subDir}/tempFile.txt`;
		await fs.promises.mkdir(subDir);
		const watcher = fs.promises.watch(rootDir);

		await fs.promises.writeFile(tempFile, 'Temporary content');
		const { promise, resolve } = Promise.withResolvers<void>();
		(async () => {
			for await (const event of watcher) {
				assert.equal(event.eventType, 'rename');
				assert.equal(event.filename, tempFile.substring(rootDir.length));
				break;
			}
			resolve();
		})();

		await fs.promises.unlink(tempFile);
		await promise;
	});
}).then(async () => {
	await fs.promises.rm(testFile);
	await fs.promises.rm(testDir, { recursive: true, force: true });
});
