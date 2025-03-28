import { Exception } from 'kerium';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { defaultContext } from '../../dist/internal/contexts.js';
import { join } from '../../dist/path.js';
import { R_OK, W_OK, X_OK } from '../../dist/vfs/constants.js';
import { fs } from '../common.js';

const asyncMode = 0o777;
const syncMode = 0o644;
const file = 'a.js';

suite('Permissions', () => {
	test('chmod', async () => {
		await fs.promises.chmod(file, asyncMode.toString(8));

		const stats = await fs.promises.stat(file);
		assert.equal(stats.mode & 0o777, asyncMode);

		fs.chmodSync(file, syncMode);
		assert.equal(fs.statSync(file).mode & 0o777, syncMode);
	});

	test('fchmod', async () => {
		const handle = await fs.promises.open(file, 'a', 0o644);

		await handle.chmod(asyncMode);
		const stats = await handle.stat();

		assert.equal(stats.mode & 0o777, asyncMode);

		fs.fchmodSync(handle.fd, syncMode);
		assert.equal(fs.statSync(file).mode & 0o777, syncMode);
	});

	test('lchmod', async () => {
		const link = 'symbolic-link';

		await fs.promises.symlink(file, link);
		await fs.promises.lchmod(link, asyncMode);

		const stats = await fs.promises.lstat(link);
		assert.equal(stats.mode & 0o777, asyncMode);

		await fs.promises.lchmod(link, syncMode);
		assert.equal((await fs.promises.lstat(link)).mode & 0o777, syncMode);
	});

	async function test_item(path: string): Promise<void> {
		const stats = await fs.promises.stat(path).catch((error: Exception) => {
			assert(error instanceof Exception);
			assert.equal(error.code, 'EACCES');
		});
		if (!stats) return;
		assert(stats.hasAccess(X_OK));

		function checkError(access: number) {
			return function (error: Exception) {
				assert(error instanceof Exception);
				assert(!stats!.hasAccess(access));
			};
		}

		if (stats.isDirectory()) {
			for (const dir of await fs.promises.readdir(path)) {
				await test('Access controls: ' + join(path, dir), () => test_item(join(path, dir)));
			}
		} else {
			await fs.promises.readFile(path).catch(checkError(R_OK));
		}
		assert(stats.hasAccess(R_OK));

		if (stats.isDirectory()) {
			const testFile = join(path, '__test_file_plz_ignore.txt');
			await fs.promises.writeFile(testFile, encodeUTF8('this is a test file, please ignore.')).catch(checkError(W_OK));
			await fs.promises.unlink(testFile).catch(checkError(W_OK));
		} else {
			const handle = await fs.promises.open(path, 'a').catch(checkError(W_OK));
			if (!handle) return;
			await handle.close();
		}
		assert(stats.hasAccess(W_OK));
	}

	const copy = { ...defaultContext.credentials };
	Object.assign(defaultContext.credentials, { uid: 1000, gid: 1000, euid: 1000, egid: 1000 });
	test('Access controls: /', () => test_item('/'));
	Object.assign(defaultContext.credentials, copy);
});
