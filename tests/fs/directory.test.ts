import assert from 'node:assert';
import { suite, test } from 'node:test';
import { ErrnoError } from '../../dist/error.js';
import { fs } from '../common.js';

const testDir = 'test-dir';
const testFiles = ['file1.txt', 'file2.txt', 'file3.txt'];
const testDirectories = ['subdir1', 'subdir2'];

fs.mkdirSync(testDir);
for (const file of testFiles) {
	fs.writeFileSync(`${testDir}/${file}`, 'Sample content');
}
for (const dir of testDirectories) {
	fs.mkdirSync(`${testDir}/${dir}`);
	for (const file of ['file4.txt', 'file5.txt']) {
		fs.writeFileSync(`${testDir}/${dir}/${file}`, 'Sample content');
	}
}

await fs._synced();

suite('Directories', () => {
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
			assert.strictEqual(error.code, 'ENOENT');
		}
		assert(!(await fs.promises.exists('/nested/dir')));
	});

	test('mkdir, recursive', async () => {
		assert.equal(await fs.promises.mkdir('/recursiveP/A/B', { recursive: true, mode: 0o755 }), '/recursiveP');
		assert.equal(await fs.promises.mkdir('/recursiveP/A/B/C/D', { recursive: true, mode: 0o777 }), '/recursiveP/A/B/C');
		assert.equal(await fs.promises.mkdir('/recursiveP/A/B/C/D', { recursive: true, mode: 0o700 }), undefined);

		assert.equal((await fs.promises.stat('/recursiveP')).mode, fs.constants.S_IFDIR | 0o755);
		assert.equal((await fs.promises.stat('/recursiveP/A')).mode, fs.constants.S_IFDIR | 0o755);
		assert.equal((await fs.promises.stat('/recursiveP/A/B')).mode, fs.constants.S_IFDIR | 0o755);
		assert.equal((await fs.promises.stat('/recursiveP/A/B/C')).mode, fs.constants.S_IFDIR | 0o777);
		assert.equal((await fs.promises.stat('/recursiveP/A/B/C/D')).mode, fs.constants.S_IFDIR | 0o777);
	});

	test('mkdirSync, recursive', () => {
		assert.equal(fs.mkdirSync('/recursiveS/A/B', { recursive: true, mode: 0o755 }), '/recursiveS');
		assert.equal(fs.mkdirSync('/recursiveS/A/B/C/D', { recursive: true, mode: 0o777 }), '/recursiveS/A/B/C');
		assert.equal(fs.mkdirSync('/recursiveS/A/B/C/D', { recursive: true, mode: 0o700 }), undefined);

		assert.equal(fs.statSync('/recursiveS').mode, fs.constants.S_IFDIR | 0o755);
		assert.equal(fs.statSync('/recursiveS/A').mode, fs.constants.S_IFDIR | 0o755);
		assert.equal(fs.statSync('/recursiveS/A/B').mode, fs.constants.S_IFDIR | 0o755);
		assert.equal(fs.statSync('/recursiveS/A/B/C').mode, fs.constants.S_IFDIR | 0o777);
		assert.equal(fs.statSync('/recursiveS/A/B/C/D').mode, fs.constants.S_IFDIR | 0o777);
	});

	test('readdirSync without permission', () => {
		try {
			fs.readdirSync('/two');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert.strictEqual(error.code, 'EACCES');
		}
	});

	test('rmdir (non-empty)', async () => {
		await fs.promises.mkdir('/rmdirTest');
		await fs.promises.mkdir('/rmdirTest/rmdirTest2');

		try {
			await fs.promises.rmdir('/rmdirTest');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert.strictEqual(error.code, 'ENOTEMPTY');
		}
	});

	test('readdirSync on file', () => {
		let wasThrown = false;

		try {
			fs.readdirSync('a.js');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			wasThrown = true;
			assert.strictEqual(error.code, 'ENOTDIR');
		}
		assert(wasThrown);
	});

	test('readdir on file', async () => {
		try {
			await fs.promises.readdir('a.js');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert.strictEqual(error.code, 'ENOTDIR');
		}
	});

	test('readdirSync on non-existant directory', () => {
		let wasThrown = false;

		try {
			fs.readdirSync('/does/not/exist');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			wasThrown = true;
			assert.strictEqual(error.code, 'ENOENT');
		}
		assert(wasThrown);
	});

	test('readdir on non-existant directory', async () => {
		try {
			await fs.promises.readdir('/does/not/exist');
		} catch (error: any) {
			assert(error instanceof ErrnoError);
			assert.strictEqual(error.code, 'ENOENT');
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

	test('readdir returns files and directories', async () => {
		const dirents = await fs.promises.readdir(testDir, { withFileTypes: true });
		const files = dirents.filter(dirent => dirent.isFile()).map(dirent => dirent.name);
		const dirs = dirents.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

		assert(testFiles.every(file => files.includes(file)));
		assert(testDirectories.every(dir => dirs.includes(dir)));
	});

	test('readdirSync returns files and directories', () => {
		const dirents = fs.readdirSync(testDir, { withFileTypes: true });
		const files = dirents.filter(dirent => dirent.isFile()).map(dirent => dirent.name);
		const dirs = dirents.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

		assert(testFiles.every(file => files.includes(file)));
		assert(testDirectories.every(dir => dirs.includes(dir)));
	});

	test('readdir returns Dirent objects', async () => {
		const dirents = await fs.promises.readdir(testDir, { withFileTypes: true });
		assert(dirents[0] instanceof fs.Dirent);
	});

	test('readdirSync returns Dirent objects', () => {
		const dirents = fs.readdirSync(testDir, { withFileTypes: true });
		assert(dirents[0] instanceof fs.Dirent);
	});

	test('readdir works without withFileTypes option', async () => {
		const files = await fs.promises.readdir(testDir);
		assert(testFiles.every(entry => files.includes(entry)));
		assert(testDirectories.every(entry => files.includes(entry)));
	});

	test('readdirSync works without withFileTypes option', () => {
		const files = fs.readdirSync(testDir);
		assert(testFiles.every(entry => files.includes(entry)));
		assert(testDirectories.every(entry => files.includes(entry)));
	});

	test('readdir returns files recursively', async () => {
		const entries = await fs.promises.readdir(testDir, { recursive: true });
		assert(entries.includes('file1.txt'));
		assert(entries.includes('subdir1/file4.txt'));
		assert(entries.includes('subdir2/file5.txt'));
	});

	test('readdir returns Dirent recursively', async () => {
		const entries = await fs.promises.readdir(testDir, { recursive: true, withFileTypes: true });
		assert(entries.find(entry => entry.path === 'file1.txt'));
		assert(entries.find(entry => entry.path === 'subdir1/file4.txt'));
		assert(entries.find(entry => entry.path === 'subdir2/file5.txt'));
	});

	// New test for readdirSync with recursive: true
	test('readdirSync returns files recursively', () => {
		const entries = fs.readdirSync(testDir, { recursive: true });
		assert(entries.includes('file1.txt'));
		assert(entries.includes('subdir1/file4.txt'));
		assert(entries.includes('subdir2/file5.txt'));
	});

	test('Cyrillic file names', () => {
		fs.writeFileSync('/мой-файл.txt', 'HELLO!', 'utf-8');
		assert(fs.readdirSync('/').includes('мой-файл.txt'));
	});
});
