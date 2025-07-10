import assert from 'node:assert/strict';
import { join } from 'node:path/posix';
import { suite, test } from 'node:test';
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

suite('Directories', () => {
	test('mkdir', async () => {
		await fs.promises.mkdir('/one', 0o755);
		assert(await fs.promises.exists('/one'));
		await assert.rejects(fs.promises.mkdir('/one', 0o755), { code: 'EEXIST' });
	});

	test('mkdirSync', async () => await fs.promises.mkdir('/two', 0o000));

	test('mkdir, nested', async () => {
		await assert.rejects(fs.promises.mkdir('/nested/dir'), { code: 'ENOENT', path: '/nested' });
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

	test('rmdir (non-empty)', async () => {
		await fs.promises.mkdir('/rmdirTest');
		await fs.promises.mkdir('/rmdirTest/rmdirTest2');

		await assert.rejects(fs.promises.rmdir('/rmdirTest'), { code: 'ENOTEMPTY' });
	});

	test('readdirSync on file', () => {
		assert.throws(() => fs.readdirSync('a.js'), { code: 'ENOTDIR' });
	});

	test('readdir on file', async () => {
		await assert.rejects(fs.promises.readdir('a.js'), { code: 'ENOTDIR' });
	});

	test('readdirSync on non-existent directory', () => {
		assert.throws(() => fs.readdirSync('/does/not/exist'), { code: 'ENOENT' });
	});

	test('readdir on non-existent directory', async () => {
		await assert.rejects(fs.promises.readdir('/does/not/exist'), { code: 'ENOENT' });
	});

	test('rm recursively', async () => {
		await fs.promises.mkdir('/rmDirRecursively');
		await fs.promises.mkdir('/rmDirRecursively/rmDirNested');
		await fs.promises.writeFile('/rmDirRecursively/rmDirNested/test.txt', 'hello world!');

		await fs.promises.rm('/rmDirRecursively', { recursive: true });
	});

	test('rmSync recursively', () => {
		fs.mkdirSync('/rmDirRecursively');
		fs.mkdirSync('/rmDirRecursively/rmDirNested');
		fs.writeFileSync('/rmDirRecursively/rmDirNested/test.txt', 'hello world!');

		fs.rmSync('/rmDirRecursively', { recursive: true });
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
		entries.sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name)));
		const values = entries.map(entry => [entry.parentPath, entry.name]);

		assert.deepEqual(values[0], [testDir, 'file1.txt']);
		assert.deepEqual(values[4], [join(testDir, 'subdir1'), 'file4.txt']);
		assert.deepEqual(values[8], [join(testDir, 'subdir2'), 'file5.txt']);
	});

	test('readdirSync returns files recursively', () => {
		const entries = fs.readdirSync(testDir, { recursive: true }).sort();
		assert.equal(entries[0], 'file1.txt');
		assert.equal(entries[4], 'subdir1/file4.txt');
		assert.equal(entries[8], 'subdir2/file5.txt');
	});

	test('Cyrillic file names', () => {
		fs.writeFileSync('/мой-файл.txt', 'HELLO!', 'utf-8');
		assert(fs.readdirSync('/').includes('мой-файл.txt'));
	});
});
