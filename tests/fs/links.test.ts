// SPDX-License-Identifier: LGPL-3.0-or-later
import { join } from '@zenfs/core/path';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.ts';

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
		assert(!(await fs.promises.stat(symlink, { throwIfNoEntry: false })));
		assert(await fs.promises.stat(target, { throwIfNoEntry: false }));
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

	test('mkdir does not follow a symlink at the final component', config('async'), async () => {
		await fs.promises.mkdir('/mkdir-real');
		await fs.promises.symlink('/mkdir-real', '/mkdir-link');
		await fs.promises.writeFile('/mkdir-file', 'contents');
		await fs.promises.symlink('/mkdir-file', '/mkdir-flink');
		await fs.promises.symlink('/mkdir-missing', '/mkdir-dangling');

		await assert.rejects(fs.promises.mkdir('/mkdir-link'), { code: 'EEXIST' });
		await assert.rejects(fs.promises.mkdir('/mkdir-dangling'), { code: 'EEXIST' });
		await assert.rejects(fs.promises.mkdir('/mkdir-flink', { recursive: true }), { code: 'EEXIST' });
		await assert.rejects(fs.promises.mkdir('/mkdir-dangling', { recursive: true }), { code: 'ENOENT' });

		// A link pointing at a directory satisfies a recursive mkdir and is left as a link
		assert.equal(await fs.promises.mkdir('/mkdir-link', { recursive: true }), undefined);
		assert((await fs.promises.lstat('/mkdir-link')).isSymbolicLink());
		assert(!(await fs.promises.stat('/mkdir-missing', { throwIfNoEntry: false })));
	});

	test('mkdir follows symlinks for intermediate components', config('async'), async () => {
		assert.equal(await fs.promises.mkdir('/mkdir-link/direct'), undefined);
		assert.equal(await fs.promises.mkdir('/mkdir-link/nested/deep', { recursive: true }), '/mkdir-link/nested');

		assert.deepEqual((await fs.promises.readdir('/mkdir-real')).sort(), ['direct', 'nested']);
		assert((await fs.promises.stat('/mkdir-real/nested/deep')).isDirectory());

		await assert.rejects(fs.promises.mkdir('/mkdir-flink/x', { recursive: true }), { code: 'ENOTDIR' });

		// Node reports the link itself here, unlike `mkdirSync` which reports the requested path with ENOENT
		await assert.rejects(fs.promises.mkdir('/mkdir-dangling/x', { recursive: true }), { code: 'ENOTDIR', path: '/mkdir-dangling' });
		assert(!(await fs.promises.stat('/mkdir-missing', { throwIfNoEntry: false })));
	});

	test('mkdirSync does not follow a symlink at the final component', config('sync'), () => {
		fs.mkdirSync('/mkdirS-real');
		fs.symlinkSync('/mkdirS-real', '/mkdirS-link');
		fs.writeFileSync('/mkdirS-file', 'contents');
		fs.symlinkSync('/mkdirS-file', '/mkdirS-flink');
		fs.symlinkSync('/mkdirS-missing', '/mkdirS-dangling');

		assert.throws(() => fs.mkdirSync('/mkdirS-link'), { code: 'EEXIST' });
		assert.throws(() => fs.mkdirSync('/mkdirS-dangling'), { code: 'EEXIST' });
		assert.throws(() => fs.mkdirSync('/mkdirS-flink', { recursive: true }), { code: 'EEXIST' });
		assert.throws(() => fs.mkdirSync('/mkdirS-dangling', { recursive: true }), { code: 'ENOENT' });

		assert.equal(fs.mkdirSync('/mkdirS-link', { recursive: true }), undefined);
		assert(fs.lstatSync('/mkdirS-link').isSymbolicLink());
		assert(!fs.existsSync('/mkdirS-missing'));
	});

	test('mkdirSync follows symlinks for intermediate components', config('sync'), () => {
		assert.equal(fs.mkdirSync('/mkdirS-link/direct'), undefined);
		assert.equal(fs.mkdirSync('/mkdirS-link/nested/deep', { recursive: true }), '/mkdirS-link/nested');

		assert.deepEqual(fs.readdirSync('/mkdirS-real').sort(), ['direct', 'nested']);
		assert(fs.statSync('/mkdirS-real/nested/deep').isDirectory());

		assert.throws(() => fs.mkdirSync('/mkdirS-flink/x', { recursive: true }), { code: 'ENOTDIR' });
		assert.throws(() => fs.mkdirSync('/mkdirS-dangling/x', { recursive: true }), { code: 'ENOENT', path: '/mkdirS-dangling/x' });
		assert(!fs.existsSync('/mkdirS-missing'));
	});

	test('writeFile and appendFile follow symlinks', config('async'), async () => {
		await fs.promises.mkdir('/wf-real');
		await fs.promises.symlink('/wf-real', '/wf-link');
		await fs.promises.writeFile('/wf-real/f.txt', 'original');
		await fs.promises.symlink('/wf-real/f.txt', '/wf-flink');
		await fs.promises.symlink('/wf-missing.txt', '/wf-dangling');

		await fs.promises.writeFile('/wf-link/new.txt', 'hi');
		assert.equal(await fs.promises.readFile('/wf-real/new.txt', 'utf8'), 'hi');

		// A link to a file is written through, not replaced
		await fs.promises.writeFile('/wf-flink', 'replaced');
		await fs.promises.appendFile('/wf-flink', '+');
		assert.equal(await fs.promises.readFile('/wf-real/f.txt', 'utf8'), 'replaced+');
		assert((await fs.promises.lstat('/wf-flink')).isSymbolicLink());

		// Writing through a dangling link creates its target
		await fs.promises.writeFile('/wf-dangling', 'made');
		assert.equal(await fs.promises.readFile('/wf-missing.txt', 'utf8'), 'made');
		assert((await fs.promises.lstat('/wf-dangling')).isSymbolicLink());
	});

	test('writeFileSync and appendFileSync follow symlinks', config('sync'), () => {
		fs.mkdirSync('/wfS-real');
		fs.symlinkSync('/wfS-real', '/wfS-link');
		fs.writeFileSync('/wfS-real/f.txt', 'original');
		fs.symlinkSync('/wfS-real/f.txt', '/wfS-flink');
		fs.symlinkSync('/wfS-missing.txt', '/wfS-dangling');

		fs.writeFileSync('/wfS-link/new.txt', 'hi');
		assert.equal(fs.readFileSync('/wfS-real/new.txt', 'utf8'), 'hi');

		fs.writeFileSync('/wfS-flink', 'replaced');
		fs.appendFileSync('/wfS-flink', '+');
		assert.equal(fs.readFileSync('/wfS-real/f.txt', 'utf8'), 'replaced+');
		assert(fs.lstatSync('/wfS-flink').isSymbolicLink());

		fs.writeFileSync('/wfS-dangling', 'made');
		assert.equal(fs.readFileSync('/wfS-missing.txt', 'utf8'), 'made');
		assert(fs.lstatSync('/wfS-dangling').isSymbolicLink());
	});

	test('cp preserves a symlink by default #304', async () => {
		await fs.promises.mkdir('/cp-src');
		await fs.promises.writeFile('/cp-src/real.txt', 'contents');
		await fs.promises.symlink('real.txt', '/cp-src/link.txt');

		await fs.promises.cp('/cp-src', '/cp-dst', { recursive: true });

		const stats = await fs.promises.lstat('/cp-dst/link.txt');
		assert(stats.isSymbolicLink());

		// A relative target is resolved against the link's directory, so the copy points at the original file
		assert.equal(await fs.promises.readlink('/cp-dst/link.txt'), '/cp-src/real.txt');
	});

	test('cp with verbatimSymlinks keeps the target unresolved', async () => {
		await fs.promises.cp('/cp-src', '/cp-verbatim', { recursive: true, verbatimSymlinks: true });

		assert((await fs.promises.lstat('/cp-verbatim/link.txt')).isSymbolicLink());
		assert.equal(await fs.promises.readlink('/cp-verbatim/link.txt'), 'real.txt');
	});

	test('cp with dereference copies the symlink target contents #304', async () => {
		await fs.promises.cp('/cp-src', '/cp-deref', { recursive: true, dereference: true });

		const stats = await fs.promises.lstat('/cp-deref/link.txt');
		assert(!stats.isSymbolicLink());
		assert.equal(await fs.promises.readFile('/cp-deref/link.txt', 'utf8'), 'contents');
	});

	test('cpSync preserves a symlink #304', () => {
		fs.writeFileSync('/cp-sync-target.txt', 'contents');
		fs.symlinkSync('cp-sync-target.txt', '/cp-sync-link');

		fs.cpSync('/cp-sync-link', '/cp-sync-link-copy');

		const stats = fs.lstatSync('/cp-sync-link-copy');
		assert(stats.isSymbolicLink());
		assert.equal(fs.readlinkSync('/cp-sync-link-copy'), '/cp-sync-target.txt');

		fs.cpSync('/cp-sync-link', '/cp-sync-link-verbatim', { verbatimSymlinks: true });
		assert.equal(fs.readlinkSync('/cp-sync-link-verbatim'), 'cp-sync-target.txt');
	});
});
