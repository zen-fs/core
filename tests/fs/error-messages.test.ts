import type { ErrnoError } from '../../src/error.js';
import { fs } from '../common.js';

const existingFile = '/exit.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function expectError(fn: (...args: any[]) => unknown, path: string, ...args: any[]) {
	let error: ErrnoError;
	try {
		await fn(path, ...args);
	} catch (err) {
		error = err;
	}
	expect(error).toBeDefined();
	expect(error.path).toBe(path);
	expect(error.message).toContain(path);
}

describe('Error messages', () => {
	const path = '/non-existent';

	test('stat', () => expectError(fs.promises.stat, path));
	test('mkdir', () => expectError(fs.promises.mkdir, existingFile, 0o666));
	test('rmdir', () => expectError(fs.promises.rmdir, path));
	test('rmdir', () => expectError(fs.promises.rmdir, existingFile));
	test('rename', () => expectError(fs.promises.rename, path, 'foo'));
	test('open', () => expectError(fs.promises.open, path, 'r'));
	test('readdir', () => expectError(fs.promises.readdir, path));
	test('unlink', () => expectError(fs.promises.unlink, path));
	test('link', () => expectError(fs.promises.link, path, 'foo'));
	test('chmod', () => expectError(fs.promises.chmod, path, 0o666));
	test('lstat', () => expectError(fs.promises.lstat, path));
	test('readlink', () => expectError(fs.promises.readlink, path));
	test('statSync', () => expectError(fs.statSync, path));
	test('mkdirSync', () => expectError(fs.mkdirSync, existingFile, 0o666));
	test('rmdirSync', () => expectError(fs.rmdirSync, path));
	test('rmdirSync', () => expectError(fs.rmdirSync, existingFile));
	test('renameSync', () => expectError(fs.renameSync, path, 'foo'));
	test('openSync', () => expectError(fs.openSync, path, 'r'));
	test('readdirSync', () => expectError(fs.readdirSync, path));
	test('unlinkSync', () => expectError(fs.unlinkSync, path));
	test('linkSync', () => expectError(fs.linkSync, path, 'foo'));
	test('chmodSync', () => expectError(fs.chmodSync, path, 0o666));
	test('lstatSync', () => expectError(fs.lstatSync, path));
	test('readlinkSync', () => expectError(fs.readlinkSync, path));
});
