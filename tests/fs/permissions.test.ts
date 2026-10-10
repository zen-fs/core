// SPDX-License-Identifier: LGPL-3.0-or-later
import { bindContext, fs as rootFS } from '@zenfs/core';
import { R_OK, W_OK, X_OK } from '@zenfs/core/constants';
import { defaultContext } from '@zenfs/core/internal/contexts';
import { hasAccess } from '@zenfs/core/internal/inode';
import { join } from '@zenfs/core/path';
import type { Exception } from 'kerium';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { config, fs } from '../common.ts';

const asyncMode = 0o777;
const syncMode = 0o644;
const file = 'a.js';

suite('Permissions', config('permissions'), () => {
	test('chmod', config('sync', 'async'), async () => {
		await fs.promises.chmod(file, asyncMode.toString(8));

		const stats = await fs.promises.stat(file);
		assert.equal(stats.mode & 0o777, asyncMode);

		fs.chmodSync(file, syncMode);
		assert.equal(fs.statSync(file).mode & 0o777, syncMode);
	});

	test('fchmod', config('sync', 'async'), async () => {
		await using handle = await fs.promises.open(file, 'a', 0o644);

		await handle.chmod(asyncMode);
		const stats = await handle.stat();

		assert.equal(stats.mode & 0o777, asyncMode);

		fs.fchmodSync(handle.fd, syncMode);
		assert.equal(fs.statSync(file).mode & 0o777, syncMode);
	});

	test('lchmod', config('lchmod', 'async'), async () => {
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
			assert.equal(error.code, 'EACCES');
		});
		if (!stats) return;
		if (stats.isDirectory()) assert(hasAccess(defaultContext, stats, X_OK));

		function checkError(access: number) {
			return function (error: Exception) {
				assert(Error.isError(error));
				assert(!hasAccess(defaultContext, stats!, access));
			};
		}

		if (stats.isDirectory()) {
			for (const dir of await fs.promises.readdir(path)) {
				await test('Access controls: ' + join(path, dir), () => test_item(join(path, dir)));
			}
		} else {
			await fs.promises.readFile(path).catch(checkError(R_OK));
		}
		assert(hasAccess(defaultContext, stats, R_OK));

		if (stats.isDirectory()) {
			const testFile = join(path, '__test_file_plz_ignore.txt');
			await fs.promises.writeFile(testFile, encodeUTF8('this is a test file, please ignore.')).catch(checkError(W_OK));
			await fs.promises.unlink(testFile).catch(checkError(W_OK));
		} else {
			const handle = await fs.promises.open(path, 'a').catch(checkError(W_OK));
			if (!handle) return;
			await handle.close();
		}
		assert(hasAccess(defaultContext, stats, W_OK));
	}

	test('unprivileged users can read files they do not own #326', async () => {
		await rootFS.promises.writeFile('/root-owned.txt', 'shared', { mode: 0o644 });
		const user = bindContext({ credentials: { uid: 1000, gid: 1000 } });

		assert.equal(user.fs.readFileSync('/root-owned.txt', 'utf8'), 'shared');
		assert.equal(await user.fs.promises.readFile('/root-owned.txt', 'utf8'), 'shared');

		assert.throws(() => user.fs.writeFileSync('/root-owned.txt', 'nope'), { code: 'EACCES' });
		await assert.rejects(user.fs.promises.writeFile('/root-owned.txt', 'nope'), { code: 'EACCES' });
	});

	test('access checks follow Linux #326', () => {
		const as = (uid: number, gid: number, euid = uid, egid = gid, groups: number[] = []) =>
			bindContext({ credentials: { uid, gid, euid, egid, groups } });
		const file = (mode: number, uid = 1000, gid = 1000) => ({ mode: 0o100000 | mode, uid, gid });

		assert(!hasAccess(as(1000, 0), file(0o600, 0, 0), R_OK));
		assert(hasAccess(as(0, 1000), file(0o000, 5, 5), R_OK | W_OK));

		assert(hasAccess(as(1000, 1000, 2000, 1000), file(0o600, 2000, 5), R_OK | W_OK));
		assert(!hasAccess(as(2000, 1000, 1000, 1000), file(0o600, 2000, 5), R_OK));
		assert(!hasAccess(as(1000, 0, 1000, 1000), file(0o060, 2000, 0), R_OK));

		assert(!hasAccess(as(1000, 1000), file(0o077), R_OK));
		assert(!hasAccess(as(1000, 1000), file(0o407, 2000), R_OK));
		assert(hasAccess(as(1000, 3000), file(0o004, 2000, 2000), R_OK));
		assert(hasAccess(as(1000, 3000, 1000, 3000, [2000]), file(0o040, 2000, 2000), R_OK));
		assert(hasAccess(as(1000, 2000), file(0o021, 0, 2000), W_OK));
		assert(!hasAccess(as(1000, 2000), file(0o021, 0, 2000), X_OK));
	});

	test('stat needs no permission on the file itself #326', async () => {
		await rootFS.promises.writeFile('/secret-stat.txt', 'x', { mode: 0o000 });
		const user = bindContext({ credentials: { uid: 1000, gid: 1000 } });

		assert.equal(user.fs.statSync('/secret-stat.txt').size, 1);
		assert.equal((await user.fs.promises.lstat('/secret-stat.txt')).size, 1);
		assert.throws(() => user.fs.readFileSync('/secret-stat.txt'), { code: 'EACCES' });
	});

	const copy = { ...defaultContext.credentials };
	Object.assign(defaultContext.credentials, { uid: 1000, gid: 1000, euid: 1000, egid: 1000 });
	test('Access controls: /', () => test_item('/'));
	Object.assign(defaultContext.credentials, copy);
});
