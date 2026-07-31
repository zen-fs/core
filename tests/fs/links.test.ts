// SPDX-License-Identifier: LGPL-3.0-or-later
import { join } from '@zenfs/core/path';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.js';

suite('Links', config('symlinks'), () => {
	const target = '/a1.js',
		symlink = 'symlink1.js',
		hardlink = 'link1.js';

	test('symlink', async () => {
		await fs.promises.symlink(target, symlink);
	});

	test('lstat', async () => {
		const stats = await fs.promises.lstat(symlink);
		assert(stats.isSymbolicLink());
	});

	test('lstat file inside symlinked directory #241', async () => {
		await fs.promises.mkdir('/a');
		await fs.promises.writeFile('/a/hello.txt', 'hello world');
		await fs.promises.symlink('/a', '/b');

		const stat = await fs.promises.lstat('/b/hello.txt');
		assert(stat.isFile());
	});

	test('readlink', async () => {
		const destination = await fs.promises.readlink(symlink);
		assert.equal(destination, target);
		assert.throws(() => fs.readlinkSync(destination));
	});

	test('read target contents', async () => {
		assert.equal(await fs.promises.readFile(target, 'utf-8'), await fs.promises.readFile(symlink, 'utf-8'));
	});

	test('nested symlinks', async () => {
		// Create the real directory structure
		const realDir = '/real-dir';
		const realFile = '/real-dir/realfile.txt';
		const fileContent = 'hello world';
		await fs.promises.mkdir(realDir);
		await fs.promises.writeFile(realFile, fileContent);
		// Create first symlink (symlink-dir -> real-dir)
		const symlinkDir = '/symlink-dir';
		await fs.promises.symlink(realDir, symlinkDir);
		const symfile = 'symfile.txt';
		const symlinkFile = join(realDir, symfile);
		// Create second symlink (symlink-dir -> real-dir)
		await fs.promises.symlink(realFile, symlinkFile);
		// Now access file through nested symlinks
		const nestedPath = join(symlinkDir, symfile);
		// Verify realpath resolution
		const resolvedPath = await fs.promises.realpath(nestedPath);
		assert.equal(resolvedPath, realFile);
		// Verify content can be read through nested symlinks
		const content = await fs.promises.readFile(nestedPath, 'utf8');
		assert.notEqual(content, '/real-dir/realfile.txt');
		assert.equal(content, fileContent);
	});

	test('unlink', async () => {
		await fs.promises.unlink(symlink);
		assert(!(await fs.promises.exists(symlink)));
		assert(await fs.promises.exists(target));
	});

	test('link', config('links'), async () => {
		await fs.promises.link(target, hardlink);
		const targetContent = await fs.promises.readFile(target, 'utf8');
		const linkContent = await fs.promises.readFile(hardlink, 'utf8');
		assert.equal(targetContent, linkContent);
	});

	test('file inside symlinked directory', async () => {
		await fs.promises.symlink('.', 'link');
		const targetContent = await fs.promises.readFile(target, 'utf8');
		const link = join('link', target);
		assert((await fs.promises.realpath(link)) === target);
		const linkContent = await fs.promises.readFile(link, 'utf8');
		assert.equal(targetContent, linkContent);
	});

	test('cp preserves a symlink by default #304', async () => {
		await fs.promises.mkdir('/cp-src');
		await fs.promises.writeFile('/cp-src/real.txt', 'contents');
		await fs.promises.symlink('real.txt', '/cp-src/link.txt');

		await fs.promises.cp('/cp-src', '/cp-dst', { recursive: true });

		const stats = await fs.promises.lstat('/cp-dst/link.txt');
		assert(stats.isSymbolicLink());
		assert.equal(await fs.promises.readlink('/cp-dst/link.txt'), 'real.txt');
	});

	test('cp with dereference copies the symlink target contents #304', async () => {
		await fs.promises.cp('/cp-src', '/cp-deref', { recursive: true, dereference: true });

		const stats = await fs.promises.lstat('/cp-deref/link.txt');
		assert(!stats.isSymbolicLink());
		assert.equal(await fs.promises.readFile('/cp-deref/link.txt', 'utf8'), 'contents');
	});

	test('cpSync preserves a symlink #304', () => {
		fs.symlinkSync('cp-sync-target.txt', '/cp-sync-link');

		fs.cpSync('/cp-sync-link', '/cp-sync-link-copy');

		const stats = fs.lstatSync('/cp-sync-link-copy');
		assert(stats.isSymbolicLink());
		assert.equal(fs.readlinkSync('/cp-sync-link-copy'), 'cp-sync-target.txt');
	});
});
