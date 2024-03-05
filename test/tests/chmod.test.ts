import { fs, createMockStats, fixturesDir } from '../common';
import * as path from 'path';
import { jest } from '@jest/globals';

const isWindows = process.platform === 'win32';
const asyncMode = 0o777;
const modeSync = 0o644;

describe('chmod tests', () => {
	it('should change file mode using chmod', async () => {
		const file1 = path.join(fixturesDir, 'a.js');

		jest.spyOn(fs, 'chmod').mockImplementation(async (path, mode) => {
			expect(path).toBe(file1);
			expect(mode).toBe(asyncMode.toString(8));
		});

		jest.spyOn(fs, 'chmodSync').mockImplementation((path, mode) => {
			expect(path).toBe(file1);
			expect(mode).toBe(modeSync);
		});

		jest.spyOn(fs, 'statSync').mockReturnValue(createMockStats(isWindows ? asyncMode & 0o777 : asyncMode));

		await changeFileMode(file1);
	});

	it('should change file mode using fchmod', async () => {
		const file2 = path.join(fixturesDir, 'a1.js');

		jest.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
			expect(path).toBe(file2);
			expect(flags).toBe('a');
			return 123;
		});

		jest.spyOn(fs, 'fchmod').mockImplementation(async (fd, mode) => {
			expect(fd).toBe(123);
			expect(mode).toBe(asyncMode.toString(8));
		});

		jest.spyOn(fs, 'fchmodSync').mockImplementation((fd, mode) => {
			expect(fd).toBe(123);
			expect(mode).toBe(modeSync);
		});

		jest.spyOn(fs, 'fstatSync').mockReturnValue(createMockStats(isWindows ? asyncMode & 0o777 : asyncMode));

		await changeFileMode(file2);
	});

	it('should change symbolic link mode using lchmod', async () => {
		const link = path.join('symbolic-link');
		const file2 = path.join(fixturesDir, 'a1.js');

		jest.spyOn(fs, 'unlinkSync').mockImplementation(path => {
			expect(path).toBe(link);
		});

		jest.spyOn(fs, 'symlinkSync').mockImplementation((target, path) => {
			expect(target).toBe(file2);
			expect(path).toBe(link);
		});

		jest.spyOn(fs, 'lchmod').mockImplementation(async (path, mode) => {
			expect(path).toBe(link);
			expect(mode).toBe(asyncMode);
		});

		jest.spyOn(fs, 'lchmodSync').mockImplementation((path, mode) => {
			expect(path).toBe(link);
			expect(mode).toBe(modeSync);
		});

		jest.spyOn(fs, 'lstatSync').mockReturnValue(createMockStats(isWindows ? asyncMode & 0o777 : asyncMode));

		await changeSymbolicLinkMode(link, file2);
	});
});

async function changeFileMode(file: string): Promise<void> {
	await fs.promises.chmod(file, asyncMode.toString(8));

	const statResult = await fs.promises.stat(file);
	expect(statResult.mode & 0o777).toBe(isWindows ? asyncMode & 0o777 : asyncMode);

	fs.chmodSync(file, modeSync);
	const statSyncResult = fs.statSync(file);
	expect(statSyncResult.mode & 0o777).toBe(isWindows ? modeSync & 0o777 : modeSync);
}

async function changeSymbolicLinkMode(link: string, target: string): Promise<void> {
	await fs.promises.unlink(link);
	await fs.promises.symlink(target, link);

	await fs.promises.lchmod(link, asyncMode);

	const lstatResult = await fs.promises.lstat(link);
	expect(lstatResult.mode & 0o777).toBe(isWindows ? asyncMode & 0o777 : asyncMode);

	fs.lchmodSync(link, modeSync);
	const lstatSyncResult = fs.lstatSync(link);
	expect(lstatSyncResult.mode & 0o777).toBe(isWindows ? modeSync & 0o777 : modeSync);
}
