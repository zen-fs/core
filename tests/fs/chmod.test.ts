import assert from 'node:assert';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const asyncMode = 0o777;
const syncMode = 0o644;

suite('chmod tests', () => {
	test('chmod', async () => {
		const file1 = 'a.js';

		await fs.promises.chmod(file1, asyncMode.toString(8));

		const stats = await fs.promises.stat(file1);
		assert((stats.mode & 0o777) === asyncMode);

		fs.chmodSync(file1, syncMode);
		assert((fs.statSync(file1).mode & 0o777) === syncMode);
	});

	test('fchmod', async () => {
		const file2 = 'a1.js';

		const handle = await fs.promises.open(file2, 'a', 0o644);

		await handle.chmod(asyncMode);
		const stats = await handle.stat();

		assert((stats.mode & 0o777) === asyncMode);

		fs.fchmodSync(handle.fd, syncMode);
		assert((fs.statSync(file2).mode & 0o777) === syncMode);
	});

	test('lchmod', async () => {
		const link = 'symbolic-link';
		const target = 'a1.js';

		await fs.promises.symlink(target, link);
		await fs.promises.lchmod(link, asyncMode);

		const stats = await fs.promises.lstat(link);
		assert((stats.mode & 0o777) === asyncMode);

		fs.lchmodSync(link, syncMode);
		assert((fs.lstatSync(link).mode & 0o777) === syncMode);
	});
});
