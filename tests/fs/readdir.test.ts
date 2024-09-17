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

describe('readdir and readdirSync', () => {
	test('readdir returns files and directories', async () => {
		const dirents = await fs.promises.readdir(testDir, { withFileTypes: true });
		const files = dirents.filter(dirent => dirent.isFile()).map(dirent => dirent.name);
		const dirs = dirents.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

		expect(files).toEqual(expect.arrayContaining(testFiles));
		expect(dirs).toEqual(expect.arrayContaining(testDirectories));
	});

	test('readdirSync returns files and directories', () => {
		const dirents = fs.readdirSync(testDir, { withFileTypes: true });
		const files = dirents.filter(dirent => dirent.isFile()).map(dirent => dirent.name);
		const dirs = dirents.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

		expect(files).toEqual(expect.arrayContaining(testFiles));
		expect(dirs).toEqual(expect.arrayContaining(testDirectories));
	});

	test('readdir returns Dirent objects', async () => {
		const dirents = await fs.promises.readdir(testDir, { withFileTypes: true });
		expect(dirents[0]).toBeInstanceOf(fs.Dirent);
	});

	test('readdirSync returns Dirent objects', () => {
		const dirents = fs.readdirSync(testDir, { withFileTypes: true });
		expect(dirents[0]).toBeInstanceOf(fs.Dirent);
	});

	test('readdir works without withFileTypes option', async () => {
		const files = await fs.promises.readdir(testDir);
		expect(files).toEqual(expect.arrayContaining([...testFiles, ...testDirectories]));
	});

	test('readdirSync works without withFileTypes option', () => {
		const files = fs.readdirSync(testDir);
		expect(files).toEqual(expect.arrayContaining([...testFiles, ...testDirectories]));
	});
});
