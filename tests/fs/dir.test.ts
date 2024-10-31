import assert, { rejects } from 'node:assert';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const testFile = 'test-file.txt';
await fs.promises.writeFile(testFile, 'Sample content');
await fs.promises.mkdir('test-directory');
await fs.promises.symlink(testFile, 'test-symlink');
const testDirPath = 'test-dir';
const testFiles = ['file1.txt', 'file2.txt'];
await fs.promises.mkdir(testDirPath);
for (const file of testFiles) {
	await fs.promises.writeFile(`${testDirPath}/${file}`, 'Sample content');
}

suite('Dirent', () => {
	test('Dirent name and parentPath getters', async () => {
		const stats = await fs.promises.lstat(testFile);
		const dirent = new fs.Dirent(testFile, stats);

		assert.equal(dirent.name, testFile);
		assert.equal(dirent.parentPath, testFile);
	});

	test('Dirent.isFile', async () => {
		const fileStats = await fs.promises.lstat(testFile);
		const fileDirent = new fs.Dirent(testFile, fileStats);

		assert(fileDirent.isFile());
		assert(!fileDirent.isDirectory());
	});

	test('Dirent.isDirectory', async () => {
		const dirStats = await fs.promises.lstat('test-directory');
		const dirDirent = new fs.Dirent('test-directory', dirStats);

		assert(!dirDirent.isFile());
		assert(dirDirent.isDirectory());
	});

	test('Dirent.isSymbolicLink', async () => {
		const symlinkStats = await fs.promises.lstat('test-symlink');
		const symlinkDirent = new fs.Dirent('test-symlink', symlinkStats);

		assert(symlinkDirent.isSymbolicLink());
	});

	test('Dirent other methods return false', async () => {
		const fileStats = await fs.promises.lstat(testFile);
		const fileDirent = new fs.Dirent(testFile, fileStats);

		assert(!fileDirent.isBlockDevice());
		assert(!fileDirent.isCharacterDevice());
		assert(!fileDirent.isSocket());
	});
});

suite('Dir', () => {
	test('Dir read() method (Promise varient)', async () => {
		const dir = new fs.Dir(testDirPath);

		const dirent1 = await dir.read();
		assert(dirent1 instanceof fs.Dirent);
		assert(testFiles.includes(dirent1?.name));

		const dirent2 = await dir.read();
		assert(dirent2 instanceof fs.Dirent);
		assert(testFiles.includes(dirent2?.name));

		const dirent3 = await dir.read();
		assert.strictEqual(dirent3, null);

		await dir.close();
	});

	test('Dir read() method (Callback varient)', (_, done) => {
		const dir = new fs.Dir(testDirPath);
		dir.read((err, dirent) => {
			assert.strictEqual(err, undefined);
			assert.notEqual(dirent, undefined);
			assert(dirent instanceof fs.Dirent);
			assert(testFiles.includes(dirent?.name));
			dir.closeSync();
			done();
		});
	});

	test('Dir readSync() method', () => {
		const dir = new fs.Dir(testDirPath);

		const dirent1 = dir.readSync();
		assert(dirent1 instanceof fs.Dirent);
		assert(testFiles.includes(dirent1?.name));

		const dirent2 = dir.readSync();
		assert(dirent2 instanceof fs.Dirent);
		assert(testFiles.includes(dirent2?.name));

		const dirent3 = dir.readSync();
		assert.strictEqual(dirent3, null);

		dir.closeSync();
	});

	test('Dir close() method (Promise version)', async () => {
		const dir = new fs.Dir(testDirPath);
		await dir.close();
		rejects(dir.read(), 'Can not use closed Dir');
	});

	test('Dir closeSync() method', () => {
		const dir = new fs.Dir(testDirPath);
		dir.closeSync();
		assert.throws(() => dir.readSync(), 'Can not use closed Dir');
	});

	test('Dir asynchronous iteration', async () => {
		const dir = new fs.Dir(testDirPath);
		const dirents: fs.Dirent[] = [];

		for await (const dirent of dir) {
			dirents.push(dirent);
		}

		assert.strictEqual(dirents.length, 2);
		assert(dirents[0] instanceof fs.Dirent);
		assert(testFiles.includes(dirents[0].name));
		assert(testFiles.includes(dirents[1].name));
	});

	test('Dir read after directory is closed', async () => {
		const dir = new fs.Dir(testDirPath);
		await dir.close();
		await assert.rejects(dir.read(), 'Can not use closed Dir');
	});

	test('Dir readSync after directory is closed', () => {
		const dir = new fs.Dir(testDirPath);
		dir.closeSync();
		assert.throws(() => dir.readSync(), 'Can not use closed Dir');
	});

	test('Dir close multiple times', async () => {
		const dir = new fs.Dir(testDirPath);
		await dir.close();
		await dir.close(); // Should not throw an error
		assert(dir['closed']);
	});

	test('Dir closeSync multiple times', () => {
		const dir = new fs.Dir(testDirPath);
		dir.closeSync();
		dir.closeSync(); // Should not throw an error
		assert(dir['closed']);
	});
});
