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

	test('an unprivileged user can read a file it does not own', async () => {
		await rootFS.promises.writeFile('/root-owned.txt', 'shared');
		await rootFS.promises.chmod('/root-owned.txt', 0o644);
		const user = bindContext({ credentials: { uid: 1000, gid: 1000, suid: 1000, sgid: 1000, euid: 1000, egid: 1000, groups: [] } });

		// The creation mode (0o644 by default) must not be checked as if it were requested access
		assert.equal(user.fs.readFileSync('/root-owned.txt', 'utf8'), 'shared');
		assert.equal(await user.fs.promises.readFile('/root-owned.txt', 'utf8'), 'shared');

		assert.throws(() => user.fs.writeFileSync('/root-owned.txt', 'nope'), { code: 'EACCES' });
		await assert.rejects(user.fs.promises.writeFile('/root-owned.txt', 'nope'), { code: 'EACCES' });
	});

	test('access checks follow Linux', () => {
		const as = (uid: number, gid: number, euid = uid, egid = gid, groups: number[] = []) =>
			bindContext({ credentials: { uid, gid, suid: uid, sgid: gid, euid, egid, groups } });
		const file = (mode: number, uid = 1000, gid = 1000) => ({ mode: 0o100000 | mode, uid, gid });

		// Group 0 is not root
		assert(!hasAccess(as(1000, 0), file(0o600, 0, 0), R_OK));
		assert(hasAccess(as(0, 1000), file(0o000, 5, 5), R_OK | W_OK));

		// Only one class applies: an owner denied by the owner bits stays denied
		assert(!hasAccess(as(1000, 1000), file(0o077), R_OK));
		assert(!hasAccess(as(1000, 1000), file(0o407, 2000), R_OK));
		assert(hasAccess(as(1000, 3000), file(0o004, 2000, 2000), R_OK));
		assert(hasAccess(as(1000, 3000, 1000, 3000, [2000]), file(0o040, 2000, 2000), R_OK));

		// The effective ids are checked, not the real ones
		assert(hasAccess(as(1000, 1000, 2000, 1000), file(0o600, 2000, 5), R_OK | W_OK));
		assert(!hasAccess(as(2000, 1000, 1000, 1000), file(0o600, 2000, 5), R_OK));
		assert(!hasAccess(as(1000, 0, 1000, 1000), file(0o060, 2000, 0), R_OK));
	});

	test('a symbolic link is created mode 0777, as on Linux', config('links', 'symlinks'), async () => {
		await fs.promises.writeFile('/link-target.txt', 'x');
		await fs.promises.symlink('/link-target.txt', '/mode-link');
		assert.equal((await fs.promises.lstat('/mode-link')).mode & 0o7777, 0o777);
		fs.symlinkSync('/link-target.txt', '/mode-link-sync');
		assert.equal(fs.lstatSync('/mode-link-sync').mode & 0o7777, 0o777);
		assert(fs.lstatSync('/mode-link-sync').isSymbolicLink());
	});

	test('removing an entry needs write access to its directory, not to the entry', async () => {
		const as = (uid: number) => bindContext({ credentials: { uid, gid: uid, suid: uid, sgid: uid, euid: uid, egid: uid, groups: [] } });
		const alice = as(1000);
		const bob = as(2000);

		await rootFS.promises.mkdir('/own-dir', { mode: 0o755 });
		await rootFS.promises.chown('/own-dir', 1000, 1000);
		await rootFS.promises.mkdir('/root-dir', { mode: 0o755 });
		await rootFS.promises.writeFile('/root-dir/guarded', 'x', { mode: 0o666 });
		await rootFS.promises.writeFile('/own-dir/readonly', 'x', { mode: 0o444 });
		await rootFS.promises.chown('/own-dir/readonly', 1000, 1000);

		// a world-writable file in a directory the user cannot write stays
		await assert.rejects(alice.fs.promises.unlink('/root-dir/guarded'), { code: 'EACCES' });
		assert.throws(() => alice.fs.unlinkSync('/root-dir/guarded'), { code: 'EACCES' });
		assert.throws(() => alice.fs.renameSync('/root-dir/guarded', '/own-dir/stolen'), { code: 'EACCES' });
		assert(rootFS.existsSync('/root-dir/guarded'));

		// a read-only file in a directory the user can write can go
		await alice.fs.promises.unlink('/own-dir/readonly');
		assert(!rootFS.existsSync('/own-dir/readonly'));

		// rmdir follows the parent, too
		await rootFS.promises.mkdir('/root-dir/sub', { mode: 0o777 });
		await assert.rejects(alice.fs.promises.rmdir('/root-dir/sub'), { code: 'EACCES' });
		assert.throws(() => bob.fs.rmdirSync('/root-dir/sub'), { code: 'EACCES' });
	});

	test('chmod, chown and utimes depend on owning the file, not on its permission bits', async () => {
		const as = (uid: number, groups: number[] = []) => bindContext({ credentials: { uid, gid: uid, suid: uid, sgid: uid, euid: uid, egid: uid, groups } });
		const alice = as(1000, [3000]);
		const bob = as(2000);

		await rootFS.promises.mkdir('/meta', { mode: 0o755 });
		await rootFS.promises.chown('/meta', 1000, 1000);
		await rootFS.promises.writeFile('/meta/readonly', 'x', { mode: 0o444 });
		await rootFS.promises.chown('/meta/readonly', 1000, 1000);
		await rootFS.promises.writeFile('/meta/open', 'x', { mode: 0o666 });
		await rootFS.promises.chown('/meta/open', 1000, 1000);

		// the owner may change a file she cannot write, sync and async, and a directory
		alice.fs.chmodSync('/meta/readonly', 0o640);
		assert.equal(rootFS.statSync('/meta/readonly').mode & 0o777, 0o640);
		await alice.fs.promises.chmod('/meta/readonly', 0o444);
		alice.fs.chmodSync('/meta', 0o700);
		assert.equal(rootFS.statSync('/meta').mode & 0o777, 0o700);
		alice.fs.chmodSync('/meta', 0o755);
		alice.fs.utimesSync('/meta', 1, 2);

		// someone who can write to the file but does not own it may not change its mode or owner
		assert.throws(() => bob.fs.chmodSync('/meta/open', 0o600), { code: 'EPERM' });
		await assert.rejects(bob.fs.promises.chmod('/meta/open', 0o600), { code: 'EPERM' });
		assert.throws(() => bob.fs.chownSync('/meta/open', 2000, 2000), { code: 'EPERM' });
		assert.equal(rootFS.statSync('/meta/open').mode & 0o777, 0o666);

		// ... but may set its times, since he can write to it, and not those of a file he cannot write
		bob.fs.utimesSync('/meta/open', 5, 6);
		assert.throws(() => bob.fs.utimesSync('/meta/readonly', 5, 6), { code: 'EPERM' });

		// only root gives a file away; an owner may pass it to a group she is in and no other
		assert.throws(() => alice.fs.chownSync('/meta/open', 2000, 1000), { code: 'EPERM' });
		alice.fs.chownSync('/meta/open', 1000, 3000);
		assert.equal(rootFS.statSync('/meta/open').gid, 3000);
		assert.throws(() => alice.fs.chownSync('/meta/open', 1000, 4000), { code: 'EPERM' });
		rootFS.chownSync('/meta/open', 2000, 2000);
		assert.equal(rootFS.statSync('/meta/open').uid, 2000);
	});

	test('stat needs no permission on the file itself', async () => {
		const user = bindContext({ credentials: { uid: 1000, gid: 1000, suid: 1000, sgid: 1000, euid: 1000, egid: 1000, groups: [] } });
		await rootFS.promises.writeFile('/secret-stat.txt', 'x', { mode: 0o000 });
		assert.equal(user.fs.statSync('/secret-stat.txt').size, 1);
		assert.equal((await user.fs.promises.lstat('/secret-stat.txt')).size, 1);
		assert.throws(() => user.fs.readFileSync('/secret-stat.txt'), { code: 'EACCES' });
	});

	test('reaching a path needs search permission on every directory leading to it', async () => {
		const as = (uid: number) => bindContext({ credentials: { uid, gid: uid, suid: uid, sgid: uid, euid: uid, egid: uid, groups: [] } });
		const alice = as(1000);
		const bob = as(2000);

		await rootFS.promises.mkdir('/private/inner', { recursive: true, mode: 0o755 });
		await rootFS.promises.chmod('/private', 0o700);
		await rootFS.promises.chown('/private', 1000, 1000);
		await rootFS.promises.writeFile('/private/inner/readable.txt', 'secret', { mode: 0o644 });
		await rootFS.promises.mkdir('/search-only', { mode: 0o711 });
		await rootFS.promises.writeFile('/search-only/known.txt', 'known', { mode: 0o644 });

		// the owner and root get in; another user does not, whatever the file's own mode says
		assert.equal(alice.fs.readFileSync('/private/inner/readable.txt', 'utf8'), 'secret');
		assert.equal(rootFS.readFileSync('/private/inner/readable.txt', 'utf8'), 'secret');
		assert.throws(() => bob.fs.readFileSync('/private/inner/readable.txt'), { code: 'EACCES' });
		await assert.rejects(bob.fs.promises.readFile('/private/inner/readable.txt'), { code: 'EACCES' });
		assert.throws(() => bob.fs.statSync('/private/inner/readable.txt'), { code: 'EACCES' });
		await assert.rejects(bob.fs.promises.stat('/private/inner/readable.txt'), { code: 'EACCES' });
		assert.throws(() => bob.fs.lstatSync('/private/inner'), { code: 'EACCES' });
		assert.throws(() => bob.fs.readdirSync('/private/inner'), { code: 'EACCES' });
		assert.throws(() => bob.fs.writeFileSync('/private/inner/new.txt', 'x'), { code: 'EACCES' });
		assert.throws(() => bob.fs.unlinkSync('/private/inner/readable.txt'), { code: 'EACCES' });
		assert.throws(() => bob.fs.mkdirSync('/private/inner/dir'), { code: 'EACCES' });
		assert.throws(() => bob.fs.renameSync('/private/inner/readable.txt', '/stolen.txt'), { code: 'EACCES' });
		assert(!rootFS.existsSync('/stolen.txt'));
		assert(rootFS.existsSync('/private/inner/readable.txt'));

		// the directory itself can be named (its parent is searchable) but not entered
		assert.throws(() => bob.fs.readdirSync('/private'), { code: 'EACCES' });
		assert.equal(bob.fs.statSync('/private').mode & 0o777, 0o700);

		// search without read: a file can be reached by name, the directory cannot be listed
		assert.equal(bob.fs.readFileSync('/search-only/known.txt', 'utf8'), 'known');
		assert.throws(() => bob.fs.readdirSync('/search-only'), { code: 'EACCES' });

		// "does it exist" is false for what cannot be reached, never an error
		assert.equal(bob.fs.existsSync('/private/inner/readable.txt'), false);
		assert.equal(await bob.fs.promises.exists('/private/inner/readable.txt'), false);
		assert.equal(bob.fs.existsSync('/search-only/known.txt'), true);

		// opening up the directory opens the path
		await rootFS.promises.chmod('/private', 0o755);
		assert.equal(bob.fs.readFileSync('/private/inner/readable.txt', 'utf8'), 'secret');
	});

	test('a sticky directory only lets owners remove their own entries', async () => {
		const as = (uid: number) => bindContext({ credentials: { uid, gid: uid, suid: uid, sgid: uid, euid: uid, egid: uid, groups: [] } });
		const alice = as(1000);
		const bob = as(2000);

		await rootFS.promises.mkdir('/sticky', { mode: 0o1777 });
		await rootFS.promises.chmod('/sticky', 0o1777);
		await alice.fs.promises.writeFile('/sticky/alice.txt', 'a');
		await alice.fs.promises.mkdir('/sticky/alice-dir');

		// another user is refused whatever the entry's own mode
		await alice.fs.promises.chmod('/sticky/alice.txt', 0o666);
		await assert.rejects(bob.fs.promises.unlink('/sticky/alice.txt'), { code: 'EPERM' });
		assert.throws(() => bob.fs.unlinkSync('/sticky/alice.txt'), { code: 'EPERM' });
		await assert.rejects(bob.fs.promises.rmdir('/sticky/alice-dir'), { code: 'EPERM' });
		assert.throws(() => bob.fs.renameSync('/sticky/alice.txt', '/sticky/bob.txt'), { code: 'EPERM' });
		await bob.fs.promises.writeFile('/sticky/bob.txt', 'b');
		assert.throws(() => alice.fs.renameSync('/sticky/alice.txt', '/sticky/bob.txt'), { code: 'EPERM' });

		// the owner, and root, may remove it
		await alice.fs.promises.unlink('/sticky/alice.txt');
		await alice.fs.promises.rmdir('/sticky/alice-dir');
		await rootFS.promises.unlink('/sticky/bob.txt');
		assert.deepEqual(rootFS.readdirSync('/sticky'), []);
	});

	const copy = { ...defaultContext.credentials };
	Object.assign(defaultContext.credentials, { uid: 1000, gid: 1000, euid: 1000, egid: 1000 });
	test('Access controls: /', () => test_item('/'));
	Object.assign(defaultContext.credentials, copy);
});
