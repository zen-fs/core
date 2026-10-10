// SPDX-License-Identifier: LGPL-3.0-or-later
import { bindContext, fs as rootFS } from '@zenfs/core';
import { R_OK, W_OK, X_OK } from '@zenfs/core/constants';
import { defaultContext } from '@zenfs/core/internal/contexts';
import { hasAccess } from '@zenfs/core/internal/inode';
import { join } from '@zenfs/core/path';
import * as vfsConfig from '@zenfs/core/vfs/config';
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

	test('removing an entry needs write and search permission on its parent #326', async () => {
		const alice = bindContext({ credentials: { uid: 1000, gid: 1000 } });

		await rootFS.promises.mkdir('/removal-root', { mode: 0o755 });
		await rootFS.promises.writeFile('/removal-root/file', 'x', { mode: 0o666 });
		await rootFS.promises.mkdir('/removal-root/dir', { mode: 0o777 });
		await rootFS.promises.mkdir('/removal-own', { mode: 0o755 });
		await rootFS.promises.lchown('/removal-own', 1000, 1000);
		await rootFS.promises.writeFile('/removal-own/readonly', 'x', { mode: 0o444 });
		await rootFS.promises.mkdir('/removal-own/readonly-dir', { mode: 0o555 });
		await rootFS.promises.mkdir('/removal-unreadable', { mode: 0o300 });
		await rootFS.promises.lchown('/removal-unreadable', 1000, 1000);
		await rootFS.promises.writeFile('/removal-unreadable/file', 'x');

		await assert.rejects(alice.fs.promises.unlink('/removal-root/file'), { code: 'EACCES' });
		assert.throws(() => alice.fs.unlinkSync('/removal-root/file'), { code: 'EACCES' });
		await assert.rejects(alice.fs.promises.rmdir('/removal-root/dir'), { code: 'EACCES' });
		assert.throws(() => alice.fs.rmdirSync('/removal-root/dir'), { code: 'EACCES' });
		assert.throws(() => alice.fs.renameSync('/removal-root/file', '/removal-own/file'), { code: 'EACCES' });
		await assert.rejects(alice.fs.promises.rename('/removal-own/readonly', '/removal-root/file'), { code: 'EACCES' });

		await alice.fs.promises.unlink('/removal-own/readonly');
		alice.fs.rmdirSync('/removal-own/readonly-dir');
		assert.deepEqual(rootFS.readdirSync('/removal-own'), []);

		await alice.fs.promises.rename('/removal-unreadable/file', '/removal-unreadable/renamed');
		alice.fs.renameSync('/removal-unreadable/renamed', '/removal-unreadable/file');
	});

	test('sticky directories only let owners remove entries #326', async () => {
		const alice = bindContext({ credentials: { uid: 1000, gid: 1000 } });
		const bob = bindContext({ credentials: { uid: 2000, gid: 2000 } });

		await rootFS.promises.mkdir('/sticky', { mode: 0o1777 });
		await alice.fs.promises.writeFile('/sticky/alice', 'a', { mode: 0o666 });
		await alice.fs.promises.mkdir('/sticky/alice-dir', { mode: 0o777 });
		await bob.fs.promises.writeFile('/sticky/bob', 'b');

		await assert.rejects(bob.fs.promises.unlink('/sticky/alice'), { code: 'EPERM' });
		assert.throws(() => bob.fs.unlinkSync('/sticky/alice'), { code: 'EPERM' });
		await assert.rejects(bob.fs.promises.rmdir('/sticky/alice-dir'), { code: 'EPERM' });
		assert.throws(() => bob.fs.rmdirSync('/sticky/alice-dir'), { code: 'EPERM' });
		assert.throws(() => bob.fs.renameSync('/sticky/alice', '/sticky/stolen'), { code: 'EPERM' });
		await assert.rejects(alice.fs.promises.rename('/sticky/alice', '/sticky/bob'), { code: 'EPERM' });

		await alice.fs.promises.unlink('/sticky/alice');
		alice.fs.rmdirSync('/sticky/alice-dir');
		await rootFS.promises.unlink('/sticky/bob');
		assert.deepEqual(rootFS.readdirSync('/sticky'), []);

		await rootFS.promises.mkdir('/sticky-alice', { mode: 0o1777 });
		await rootFS.promises.lchown('/sticky-alice', 1000, 1000);
		await bob.fs.promises.writeFile('/sticky-alice/bob', 'b');
		await alice.fs.promises.unlink('/sticky-alice/bob');
	});

	test('only owners may change the mode, owner, or times of a file #326', async () => {
		const alice = bindContext({ credentials: { uid: 1000, gid: 1000, groups: [3000] } });
		const bob = bindContext({ credentials: { uid: 2000, gid: 2000 } });

		await rootFS.promises.writeFile('/owned', 'x', { mode: 0o666 });
		rootFS.chownSync('/owned', 1000, 1000);

		assert.throws(() => bob.fs.chmodSync('/owned', 0o600), { code: 'EPERM' });
		await assert.rejects(bob.fs.promises.chmod('/owned', 0o600), { code: 'EPERM' });
		assert.throws(() => bob.fs.utimesSync('/owned', 1, 2), { code: 'EPERM' });
		await assert.rejects(bob.fs.promises.utimes('/owned', 1, 2), { code: 'EPERM' });
		assert.throws(() => bob.fs.chownSync('/owned', -1, 2000), { code: 'EPERM' });
		assert.throws(() => bob.fs.chownSync('/owned', 1000, -1), { code: 'EPERM' });
		bob.fs.chownSync('/owned', -1, -1);

		alice.fs.chmodSync('/owned', 0o644);
		await alice.fs.promises.utimes('/owned', 1, 2);
		alice.fs.chownSync('/owned', -1, 3000);
		await alice.fs.promises.chown('/owned', 1000, 1000);
		assert.throws(() => alice.fs.chownSync('/owned', -1, 4000), { code: 'EPERM' });
		assert.throws(() => alice.fs.chownSync('/owned', 2000, -1), { code: 'EPERM' });

		rootFS.chownSync('/owned', 2000, 2000);
		const stats = rootFS.statSync('/owned');
		assert.equal(stats.mode & 0o777, 0o644);
		assert.equal(stats.mtimeMs, 2000);
		assert.equal(stats.uid, 2000);
	});

	test('moving a directory to another parent needs write permission on it', async () => {
		const alice = bindContext({ credentials: { uid: 1000, gid: 1000 } });

		await rootFS.promises.mkdir('/move-a', { mode: 0o777 });
		await rootFS.promises.mkdir('/move-b', { mode: 0o777 });
		await rootFS.promises.mkdir('/move-a/dir', { mode: 0o755 });
		await rootFS.promises.writeFile('/move-a/file', 'x', { mode: 0o644 });

		assert.throws(() => alice.fs.renameSync('/move-a/dir', '/move-b/dir'), { code: 'EACCES' });
		await assert.rejects(alice.fs.promises.rename('/move-a/dir', '/move-b/dir'), { code: 'EACCES' });
		await alice.fs.promises.rename('/move-a/dir', '/move-a/renamed');
		await alice.fs.promises.rename('/move-a/file', '/move-b/file');
	});

	test('chmod and chown clear setuid and setgid like Linux', async () => {
		const alice = bindContext({ credentials: { uid: 1000, gid: 1000, groups: [3000] } });
		const modeOf = (path: string) => rootFS.statSync(path).mode & 0o7777;

		await rootFS.promises.mkdir('/sid', { mode: 0o777 });
		await alice.fs.promises.writeFile('/sid/file', 'x');
		await alice.fs.promises.mkdir('/sid/dir');

		alice.fs.chmodSync('/sid/file', 0o6755);
		assert.equal(modeOf('/sid/file'), 0o6755);
		alice.fs.chownSync('/sid/file', -1, -1);
		assert.equal(modeOf('/sid/file'), 0o755);

		alice.fs.chmodSync('/sid/file', 0o2745);
		alice.fs.chownSync('/sid/file', -1, 3000);
		assert.equal(modeOf('/sid/file'), 0o2745);

		rootFS.chmodSync('/sid/file', 0o4755);
		rootFS.chownSync('/sid/file', 1000, 0);
		assert.equal(modeOf('/sid/file'), 0o755);

		alice.fs.chmodSync('/sid/file', 0o2755);
		assert.equal(modeOf('/sid/file'), 0o755);

		await alice.fs.promises.lchmod('/sid/dir', 0o6755);
		await alice.fs.promises.lchown('/sid/dir', -1, -1);
		assert.equal(modeOf('/sid/dir'), 0o6755);
	});

	test('access checks see unsynced changes to an open file', async () => {
		const alice = bindContext({ credentials: { uid: 1000, gid: 1000 } });

		await rootFS.promises.writeFile('/unsynced', 'x', { mode: 0o644 });
		const fd = rootFS.openSync('/unsynced', 'r');
		rootFS.fchmodSync(fd, 0o600);

		assert.throws(() => alice.fs.readFileSync('/unsynced'), { code: 'EACCES' });
		await assert.rejects(alice.fs.promises.readFile('/unsynced'), { code: 'EACCES' });
		rootFS.closeSync(fd);
	});

	test('reaching a path needs search permission on every directory leading to it #326', async () => {
		const alice = bindContext({ credentials: { uid: 1000, gid: 1000 } });
		const bob = bindContext({ credentials: { uid: 2000, gid: 2000 } });

		await rootFS.promises.mkdir('/private', { mode: 0o700 });
		await rootFS.promises.lchown('/private', 1000, 1000);
		await rootFS.promises.mkdir('/private/inner', { mode: 0o755 });
		await rootFS.promises.writeFile('/private/inner/readable.txt', 'secret', { mode: 0o644 });
		await rootFS.promises.symlink('/private', '/private-link');
		await rootFS.promises.mkdir('/search-only', { mode: 0o711 });
		await rootFS.promises.writeFile('/search-only/known.txt', 'known', { mode: 0o644 });
		await rootFS.promises.mkdir('/no-search', { mode: 0o722 });

		assert.throws(() => bob.fs.readFileSync('/private-link/inner/readable.txt'), { code: 'EACCES' });
		await assert.rejects(bob.fs.promises.readFile('/private-link/inner/readable.txt'), { code: 'EACCES' });
		assert.throws(() => bob.fs.lstatSync('/private/inner'), { code: 'EACCES' });
		assert.throws(() => bob.fs.mkdirSync('/no-search/dir'), { code: 'EACCES' });
		assert.throws(() => bob.fs.writeFileSync('/no-search/file', 'x'), { code: 'EACCES' });

		const { checkAccess, resolveFullWalk } = vfsConfig;
		vfsConfig._setVFSConfig({ checkAccess, resolveFullWalk: true });
		try {
			assert.equal(alice.fs.readFileSync('/private/inner/readable.txt', 'utf8'), 'secret');
			assert.equal(rootFS.readFileSync('/private/inner/readable.txt', 'utf8'), 'secret');

			assert.throws(() => bob.fs.readFileSync('/private/inner/readable.txt'), { code: 'EACCES' });
			await assert.rejects(bob.fs.promises.readFile('/private/inner/readable.txt'), { code: 'EACCES' });
			assert.throws(() => bob.fs.statSync('/private/inner/readable.txt'), { code: 'EACCES' });
			await assert.rejects(bob.fs.promises.stat('/private/inner/readable.txt'), { code: 'EACCES' });
			assert.throws(() => bob.fs.readdirSync('/private/inner'), { code: 'EACCES' });
			assert.throws(() => bob.fs.writeFileSync('/private/inner/new.txt', 'x'), { code: 'EACCES' });
			assert.throws(() => bob.fs.unlinkSync('/private/inner/readable.txt'), { code: 'EACCES' });
			assert.throws(() => bob.fs.mkdirSync('/private/inner/dir'), { code: 'EACCES' });
			assert.throws(() => bob.fs.renameSync('/private/inner/readable.txt', '/stolen.txt'), { code: 'EACCES' });
			assert(rootFS.existsSync('/private/inner/readable.txt'));

			assert.equal(bob.fs.statSync('/private').mode & 0o777, 0o700);
			assert.throws(() => bob.fs.readdirSync('/private'), { code: 'EACCES' });

			assert.equal(bob.fs.readFileSync('/search-only/known.txt', 'utf8'), 'known');
			assert.throws(() => bob.fs.readdirSync('/search-only'), { code: 'EACCES' });

			assert.equal(bob.fs.existsSync('/private/inner/readable.txt'), false);
			assert.equal(await bob.fs.promises.exists('/private/inner/readable.txt'), false);
			assert.equal(bob.fs.existsSync('/search-only/known.txt'), true);
		} finally {
			vfsConfig._setVFSConfig({ checkAccess, resolveFullWalk });
		}
	});

	const copy = { ...defaultContext.credentials };
	Object.assign(defaultContext.credentials, { uid: 1000, gid: 1000, euid: 1000, egid: 1000 });
	test('Access controls: /', () => test_item('/'));
	Object.assign(defaultContext.credentials, copy);
});
