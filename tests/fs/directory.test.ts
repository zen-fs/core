import assert from 'node:assert';
import { suite, test } from 'node:test';
import { ErrnoError } from '../../src/error.js';
import { fs } from '../common.js';

suite('Directory', () => {
	test('mkdir', async () => {
		await fs.promises.mkdir('/one', 0o755);
		assert(await fs.promises.exists('/one'));
		await assert.rejects(fs.promises.mkdir('/one', 0o755), /EEXIST/);
	});

	test('mkdirSync', () => fs.mkdirSync('/two', 0o000));

	test('mkdir, nested', async () => {
		try {
			await fs.promises.mkdir('/nested/dir');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert(error.code === 'ENOENT');
		}
		assert(!(await fs.promises.exists('/nested/dir')));
	});

	test('mkdir, recursive', async () => {
		assert((await fs.promises.mkdir('/recursiveP/A/B', { recursive: true, mode: 0o755 })) == '/recursiveP');
		assert((await fs.promises.mkdir('/recursiveP/A/B/C/D', { recursive: true, mode: 0o777 })) == '/recursiveP/A/B/C');
		assert((await fs.promises.mkdir('/recursiveP/A/B/C/D', { recursive: true, mode: 0o700 })) == undefined);

		assert((await fs.promises.stat('/recursiveP')).mode == (fs.constants.S_IFDIR | 0o755));
		assert((await fs.promises.stat('/recursiveP/A')).mode == (fs.constants.S_IFDIR | 0o755));
		assert((await fs.promises.stat('/recursiveP/A/B')).mode == (fs.constants.S_IFDIR | 0o755));
		assert((await fs.promises.stat('/recursiveP/A/B/C')).mode == (fs.constants.S_IFDIR | 0o777));
		assert((await fs.promises.stat('/recursiveP/A/B/C/D')).mode == (fs.constants.S_IFDIR | 0o777));
	});

	test('mkdirSync, recursive', () => {
		assert(fs.mkdirSync('/recursiveS/A/B', { recursive: true, mode: 0o755 }) === '/recursiveS');
		assert(fs.mkdirSync('/recursiveS/A/B/C/D', { recursive: true, mode: 0o777 }) === '/recursiveS/A/B/C');
		assert(fs.mkdirSync('/recursiveS/A/B/C/D', { recursive: true, mode: 0o700 }) === undefined);

		assert(fs.statSync('/recursiveS').mode == (fs.constants.S_IFDIR | 0o755));
		assert(fs.statSync('/recursiveS/A').mode == (fs.constants.S_IFDIR | 0o755));
		assert(fs.statSync('/recursiveS/A/B').mode == (fs.constants.S_IFDIR | 0o755));
		assert(fs.statSync('/recursiveS/A/B/C').mode == (fs.constants.S_IFDIR | 0o777));
		assert(fs.statSync('/recursiveS/A/B/C/D').mode == (fs.constants.S_IFDIR | 0o777));
	});

	test('readdirSync without permission', () => {
		try {
			fs.readdirSync('/two');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert(error.code === 'EACCES');
		}
	});

	test('rmdir (non-empty)', async () => {
		await fs.promises.mkdir('/rmdirTest');
		await fs.promises.mkdir('/rmdirTest/rmdirTest2');

		try {
			await fs.promises.rmdir('/rmdirTest');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert(error.code === 'ENOTEMPTY');
		}
	});

	test('readdirSync on file', () => {
		let wasThrown = false;

		try {
			fs.readdirSync('a.js');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			wasThrown = true;
			assert(error.code === 'ENOTDIR');
		}
		assert(wasThrown);
	});

	test('readdir on file', async () => {
		try {
			await fs.promises.readdir('a.js');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert(error.code === 'ENOTDIR');
		}
	});

	test('readdirSync on non-existant directory', () => {
		let wasThrown = false;

		try {
			fs.readdirSync('/does/not/exist');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			wasThrown = true;
			assert(error.code === 'ENOENT');
		}
		assert(wasThrown);
	});

	test('readdir on non-existant directory', async () => {
		try {
			await fs.promises.readdir('/does/not/exist');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert(error.code === 'ENOENT');
		}
	});

	test('rm recursively asynchronously', async () => {
		await fs.promises.mkdir('/rmDirRecusrively');
		await fs.promises.mkdir('/rmDirRecusrively/rmDirNested');
		await fs.promises.writeFile('/rmDirRecusrively/rmDirNested/test.txt', 'hello world!');

		await fs.promises.rm('/rmDirRecusrively', { recursive: true });
	});

	test('rm recursively synchronously', () => {
		fs.mkdirSync('/rmDirRecusrively');
		fs.mkdirSync('/rmDirRecusrively/rmDirNested');
		fs.writeFileSync('/rmDirRecusrively/rmDirNested/test.txt', 'hello world!');

		fs.rmSync('/rmDirRecusrively', { recursive: true });
	});
});
