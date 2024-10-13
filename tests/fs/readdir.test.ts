import assert from 'node:assert';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const testDir = 'test-dir';
const testFiles = ['file1.txt', 'file2.txt', 'file3.txt'];
const testDirectories = ['subdir1', 'subdir2'];

await fs.promises.mkdir(testDir);
for (const file of testFiles) {
	await fs.promises.writeFile(`${testDir}/${file}`, 'Sample content');
}
for (const dir of testDirectories) {
	await fs.promises.mkdir(`${testDir}/${dir}`);
}

suite('readdir and readdirSync', () => {
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

	test('Cyrillic file names', () => {
		fs.writeFileSync('/мой-файл.txt', 'HELLO!', 'utf-8');
		assert(fs.readdirSync('/').includes('мой-файл.txt'));
	});
});
