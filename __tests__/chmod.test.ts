import { fs } from '../test-utils/common';

const asyncMode = 0o777;
const syncMode = 0o644;

describe('chmod tests', () => {
	test('chmod', async () => {
		const file1 = 'a.js';

		await fs.promises.chmod(file1, asyncMode.toString(8));

		const stats = await fs.promises.stat(file1);
		expect(stats.mode & 0o777).toBe(asyncMode);

		fs.chmodSync(file1, syncMode);
		expect(fs.statSync(file1).mode & 0o777).toBe(syncMode);
	});

	test('fchmod', async () => {
		const file2 = 'a1.js';

		const handle = await fs.promises.open(file2, 'a', 0o644);

		await handle.chmod(asyncMode);
		const stats = await handle.stat();

		expect(stats.mode & 0o777).toBe(asyncMode);

		fs.fchmodSync(handle.fd, syncMode);
		expect(fs.statSync(file2).mode & 0o777).toBe(syncMode);
	});

	test('lchmod', async () => {
		const link = 'symbolic-link';
		const target = 'a1.js';

		await fs.promises.symlink(target, link);
		await fs.promises.lchmod(link, asyncMode);

		const stats = await fs.promises.lstat(link);
		expect(stats.mode & 0o777).toBe(asyncMode);

		fs.lchmodSync(link, syncMode);
		expect(fs.lstatSync(link).mode & 0o777).toBe(syncMode);
	});
});
