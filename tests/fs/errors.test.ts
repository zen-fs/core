// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import test, { suite } from 'node:test';
import { config, fs } from '../common.ts';

const existingFile = '/exit.js';
const path = '/non-existent';

interface Case {
	/** The name of the test */
	name: string;
	code: string;
	/** The syscall the error should be attributed to, which is not always the name of the function */
	syscall: string;
	path: string;
	dest?: string;
	sync: (this: void) => unknown;
	async: (this: void) => Promise<unknown>;
}

const cases: Case[] = [
	{
		name: 'stat',
		code: 'ENOENT',
		syscall: 'stat',
		path,
		sync: () => fs.statSync(path),
		async: () => fs.promises.stat(path),
	},
	{
		name: 'lstat',
		code: 'ENOENT',
		syscall: 'lstat',
		path,
		sync: () => fs.lstatSync(path),
		async: () => fs.promises.lstat(path),
	},
	{
		name: 'mkdir',
		code: 'EEXIST',
		syscall: 'mkdir',
		path: existingFile,
		sync: () => fs.mkdirSync(existingFile, 0o666),
		async: () => fs.promises.mkdir(existingFile, 0o666),
	},
	{
		name: 'rmdir (missing)',
		code: 'ENOENT',
		syscall: 'rmdir',
		path,
		sync: () => fs.rmdirSync(path),
		async: () => fs.promises.rmdir(path),
	},
	{
		name: 'rmdir (not a directory)',
		code: 'ENOTDIR',
		syscall: 'rmdir',
		path: existingFile,
		sync: () => fs.rmdirSync(existingFile),
		async: () => fs.promises.rmdir(existingFile),
	},
	{
		name: 'rename',
		code: 'ENOENT',
		syscall: 'rename',
		path,
		dest: '/foo',
		sync: () => fs.renameSync(path, 'foo'),
		async: () => fs.promises.rename(path, 'foo'),
	},
	{
		name: 'open',
		code: 'ENOENT',
		syscall: 'open',
		path,
		sync: () => fs.openSync(path, 'r'),
		async: () => fs.promises.open(path, 'r'),
	},
	{
		// Note Node attributes `readdir` failures to `scandir`
		name: 'readdir',
		code: 'ENOENT',
		syscall: 'scandir',
		path,
		sync: () => fs.readdirSync(path),
		async: () => fs.promises.readdir(path),
	},
	{
		name: 'unlink',
		code: 'ENOENT',
		syscall: 'unlink',
		path,
		sync: () => fs.unlinkSync(path),
		async: () => fs.promises.unlink(path),
	},
	{
		// Note `path` is the existing file and `dest` is the new link
		name: 'link',
		code: 'ENOENT',
		syscall: 'link',
		path,
		dest: '/foo',
		sync: () => fs.linkSync(path, 'foo'),
		async: () => fs.promises.link(path, 'foo'),
	},
	{
		name: 'chmod',
		code: 'ENOENT',
		syscall: 'chmod',
		path,
		sync: () => fs.chmodSync(path, 0o666),
		async: () => fs.promises.chmod(path, 0o666),
	},
	{
		name: 'readlink',
		code: 'ENOENT',
		syscall: 'readlink',
		path,
		sync: () => fs.readlinkSync(path),
		async: () => fs.promises.readlink(path),
	},
];

/**
 * Checks an error against the expected code, syscall, path, and message.
 *
 * The message is only matched at the start, since the description text for an errno
 * is not standardized and implementations may add more information at the end.
 */
function check(error: unknown, c: Case): void {
	const e = error as NodeJS.ErrnoException & { dest?: string };

	assert.equal(e.code, c.code);
	assert.equal(e.syscall, c.syscall);
	assert.equal(e.path, c.path);
	if (c.dest) assert.equal(e.dest, c.dest);

	// e.g. `ENOENT: no such file or directory, stat '/non-existent'`
	const expected = new RegExp(`^${c.code}: .+, ${c.syscall} '${c.path}'` + (c.dest ? ` -> '${c.dest}'` : ''));
	assert.match(e.message, expected);
}

suite('Error messages', () => {
	for (const c of cases) {
		test(c.name, config('async'), async () => {
			await assert.rejects(c.async, (error: unknown) => {
				check(error, c);
				return true;
			});
		});

		test(c.name + 'Sync', config('sync'), () => {
			assert.throws(c.sync, (error: unknown) => {
				check(error, c);
				return true;
			});
		});
	}
});
