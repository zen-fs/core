import assert from 'node:assert';
import { suite, test } from 'node:test';
import { fs, configure, InMemory } from '../common.js';

const testDir = 'test-dir';
const testFiles = ['file1.txt', 'file2.txt', 'file3.txt'];
const testDirectories = ['subdir1', 'subdir2'];

await fs.promises.mkdir(testDir);
for (const file of testFiles) {
	await fs.promises.writeFile(`${testDir}/${file}`, 'Sample content');
}
for (const dir of testDirectories) {
	await fs.promises.mkdir(`${testDir}/${dir}`);
	for (const file of ['file4.txt', 'file5.txt']) {
		await fs.promises.writeFile(`${testDir}/${dir}/${file}`, 'Sample content');
	}
}

// must make any dirs that are mounted
fs.mkdirSync('/mnt/tester', { recursive: true })
fs.mkdirSync('/deep/stuff/here', { recursive: true })
fs.mkdirSync('/top')

await configure({
	mounts: {
		'/mnt/tester': InMemory,
		'/deep/stuff/here': InMemory,
		'/top': InMemory
	}
})
fs.writeFileSync('/deep/stuff/here/gotcha.txt', 'Hi!')

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

	test('readdir from a new mount (recursive)', () => {
		const entries = fs.readdirSync('/', {recursive: true})
  	assert(entries.includes('deep/stuff/here/gotcha.txt'));
	});
});
