// SPDX-License-Identifier: LGPL-3.0-or-later
import { defaultContext, hasAccess, type Stats } from '@zenfs/core';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.ts';

suite('Stats', () => {
	const existing_file = 'x.txt';

	test('stat empty path', config('async'), async () => {
		await assert.rejects(fs.promises.stat(''));
	});

	test('stat directory', config('async'), async () => {
		const stats = await fs.promises.stat('/');
		assert(stats instanceof fs.Stats);
	});

	test('lstat directory', config('async'), async () => {
		const stats = await fs.promises.lstat('/');
		assert(stats instanceof fs.Stats);
	});

	test('FileHandle.stat', config('async'), async () => {
		const handle = await fs.promises.open(existing_file, 'r');
		const stats = await handle.stat();
		assert(stats instanceof fs.Stats);
		await handle.close();
	});

	test('fstatSync file', config('sync'), () => {
		const fd = fs.openSync(existing_file, 'r');
		const stats = fs.fstatSync(fd);
		assert(stats instanceof fs.Stats);
		fs.close(fd);
	});

	test('hasAccess for non-root access', config('sync', 'permissions', 'root'), () => {
		const newFile = 'new.txt';

		fs.writeFileSync(newFile, 'hello', { mode: 0o640 });

		const prevCredentials = { ...defaultContext.credentials };
		const uid = 33;
		const nonRootCredentials = {
			uid,
			gid: uid,
			euid: uid,
			egid: uid,
			suid: uid,
			sgid: uid,
		};

		fs.chownSync(newFile, 0, nonRootCredentials.gid); // creating with root-user so that non-root user can access

		Object.assign(defaultContext.credentials, nonRootCredentials);
		const stat = fs.statSync(newFile);

		assert.equal(stat.gid, nonRootCredentials.gid);
		assert.equal(stat.uid, 0);
		assert.equal(hasAccess(defaultContext, stat, fs.constants.R_OK), true);
		assert.equal(hasAccess(defaultContext, stat, fs.constants.W_OK), false);
		assert.equal(hasAccess(defaultContext, stat, fs.constants.X_OK), false);
		// changing group

		Object.assign(defaultContext.credentials, { ...nonRootCredentials, gid: 44 });

		assert.equal(hasAccess(defaultContext, stat, fs.constants.R_OK), false);
		assert.equal(hasAccess(defaultContext, stat, fs.constants.W_OK), false);
		assert.equal(hasAccess(defaultContext, stat, fs.constants.X_OK), false);

		Object.assign(defaultContext.credentials, prevCredentials);
	});

	const missing = '/does-not-exist';

	test('statSync throws for a missing entry', config('sync'), () => {
		assert.throws(() => fs.statSync(missing), { code: 'ENOENT' });
		assert.throws(() => fs.statSync(missing, { throwIfNoEntry: true }), { code: 'ENOENT' });
	});

	test('statSync with throwIfNoEntry: false', config('sync'), () => {
		assert.equal(fs.statSync(missing, { throwIfNoEntry: false }), undefined);
		assert.equal(fs.statSync(existing_file + '/nope', { throwIfNoEntry: false }), undefined);
	});

	test('lstatSync with throwIfNoEntry: false', config('sync'), () => {
		assert.throws(() => fs.lstatSync(missing), { code: 'ENOENT' });
		assert.equal(fs.lstatSync(missing, { throwIfNoEntry: false }), undefined);
	});

	test('stat with throwIfNoEntry: false', config('async'), async () => {
		await assert.rejects(fs.promises.stat(missing), { code: 'ENOENT' });
		assert.equal(await fs.promises.stat(missing, { throwIfNoEntry: false }), undefined);
		assert.equal(await fs.promises.stat(existing_file + '/nope', { throwIfNoEntry: false }), undefined);
	});

	test('stat callback with throwIfNoEntry: false', config('async'), async () => {
		const { promise, resolve, reject } = Promise.withResolvers<Stats | undefined>();
		fs.stat(missing, { throwIfNoEntry: false }, (error, stats) => (error ? reject(error) : resolve(stats)));
		assert.equal(await promise, undefined);
	});

	test('stat file', config('async'), async () => {
		const stats = await fs.promises.stat(existing_file);
		assert(!stats.isDirectory());
		assert(stats.isFile());
		assert(!stats.isSocket());
		assert(!stats.isBlockDevice());
		assert(!stats.isCharacterDevice());
		assert(!stats.isFIFO());
		assert(!stats.isSymbolicLink());
		assert(stats instanceof fs.Stats);
	});
});
