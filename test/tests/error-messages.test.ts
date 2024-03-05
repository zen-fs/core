import { fs, fixturesDir } from '../common';
import * as path from 'path';

import type { ApiError } from '../../src/ApiError';

const existingFile = path.join(fixturesDir, 'exit.js');

const expectError = async (fn: (...args) => Promise<unknown>, p: string, ...args) => {
	let error: ApiError;
	try {
		await fn(p, ...args);
	} catch (err) {
		error = err;
	}
	expect(error).toBeDefined();
	expect(error.path).toBe(p);
	expect(error.message).toContain(p);
	return error;
};

const expectSyncError = (fn: (...args) => unknown, p: string, ...args) => {
	let error: ApiError;
	try {
		fn(p, ...args);
	} catch (err) {
		error = err;
	}
	expect(error).toBeDefined();
	expect(error.path).toBe(p);
	expect(error.message).toContain(p);
	return error;
};

describe('Error tests', () => {
	it('should handle async operations with error', async () => {
		const fn = path.join(fixturesDir, 'non-existent');

		await expectError(fs.promises.stat, fn);

		if (!fs.getMount('/').metadata.readonly) {
			await expectError(fs.promises.mkdir, existingFile, 0o666);
			await expectError(fs.promises.rmdir, fn);
			await expectError(fs.promises.rmdir, existingFile);
			await expectError(fs.promises.rename, fn, 'foo');
			await expectError(fs.promises.open, fn, 'r');
			await expectError(fs.promises.readdir, fn);
			await expectError(fs.promises.unlink, fn);
			await expectError(fs.promises.link, fn, 'foo');

			if (fs.getMount('/').metadata.supportsProperties) {
				await expectError(fs.promises.chmod, fn, 0o666);
			}
		}

		await expectError(fs.promises.lstat, fn);
		await expectError(fs.promises.readlink, fn);
	});

	// Sync operations
	if (fs.getMount('/').metadata.synchronous) {
		it('should handle sync operations with error', () => {
			const fn = path.join(fixturesDir, 'non-existent');
			const existingFile = path.join(fixturesDir, 'exit.js');

			expectSyncError(fs.statSync, fn);

			if (!fs.getMount('/').metadata.readonly) {
				expectSyncError(fs.mkdirSync, existingFile, 0o666);
				expectSyncError(fs.rmdirSync, fn);
				expectSyncError(fs.rmdirSync, existingFile);
				expectSyncError(fs.renameSync, fn, 'foo');
				expectSyncError(fs.openSync, fn, 'r');
				expectSyncError(fs.readdirSync, fn);
				expectSyncError(fs.unlinkSync, fn);
				expectSyncError(fs.linkSync, fn, 'foo');

				if (fs.getMount('/').metadata.supportsProperties) {
					expectSyncError(fs.chmodSync, fn, 0o666);
				}
			}

			expectSyncError(fs.lstatSync, fn);
			expectSyncError(fs.readlinkSync, fn);
		});
	}
});
