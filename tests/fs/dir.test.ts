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

describe('Dirent', () => {
	test('Dirent name and parentPath getters', async () => {
		const stats = await fs.promises.lstat(testFile);
		const dirent = new fs.Dirent(testFile, stats);

		expect(dirent.name).toBe(testFile);
		expect(dirent.parentPath).toBe(testFile);
	});

	test('Dirent.isFile', async () => {
		const fileStats = await fs.promises.lstat(testFile);
		const fileDirent = new fs.Dirent(testFile, fileStats);

		expect(fileDirent.isFile()).toBe(true);
		expect(fileDirent.isDirectory()).toBe(false);
	});

	test('Dirent.isDirectory', async () => {
		const dirStats = await fs.promises.lstat('test-directory');
		const dirDirent = new fs.Dirent('test-directory', dirStats);

		expect(dirDirent.isFile()).toBe(false);
		expect(dirDirent.isDirectory()).toBe(true);
	});

	test('Dirent.isSymbolicLink', async () => {
		const symlinkStats = await fs.promises.lstat('test-symlink');
		const symlinkDirent = new fs.Dirent('test-symlink', symlinkStats);

		expect(symlinkDirent.isSymbolicLink()).toBe(true);
	});

	test('Dirent other methods return false', async () => {
		const fileStats = await fs.promises.lstat(testFile);
		const fileDirent = new fs.Dirent(testFile, fileStats);

		expect(fileDirent.isBlockDevice()).toBe(false);
		expect(fileDirent.isCharacterDevice()).toBe(false);
		expect(fileDirent.isSocket()).toBe(false);
	});
});

describe('Dir', () => {
	test('Dir read() method (Promise varient)', async () => {
		const dir = new fs.Dir(testDirPath);

		const dirent1 = await dir.read();
		expect(dirent1).toBeInstanceOf(fs.Dirent);
		expect(testFiles).toContain(dirent1?.name);

		const dirent2 = await dir.read();
		expect(dirent2).toBeInstanceOf(fs.Dirent);
		expect(testFiles).toContain(dirent2?.name);

		const dirent3 = await dir.read();
		expect(dirent3).toBeNull();

		await dir.close();
	});

	test('Dir read() method (Callback varient)', done => {
		const dir = new fs.Dir(testDirPath);
		dir.read((err, dirent) => {
			expect(err).toBeUndefined();
			expect(dirent).toBeDefined();
			expect(dirent).toBeInstanceOf(fs.Dirent);
			expect(testFiles).toContain(dirent?.name);
			dir.closeSync();
			done();
		});
	});

	test('Dir readSync() method', () => {
		const dir = new fs.Dir(testDirPath);

		const dirent1 = dir.readSync();
		expect(dirent1).toBeInstanceOf(fs.Dirent);
		expect(testFiles).toContain(dirent1?.name);

		const dirent2 = dir.readSync();
		expect(dirent2).toBeInstanceOf(fs.Dirent);
		expect(testFiles).toContain(dirent2?.name);

		const dirent3 = dir.readSync();
		expect(dirent3).toBeNull();

		dir.closeSync();
	});

	test('Dir close() method (Promise version)', async () => {
		const dir = new fs.Dir(testDirPath);
		await dir.close();
		await expect(dir.read()).rejects.toThrow('Can not use closed Dir');
	});

	test('Dir closeSync() method', () => {
		const dir = new fs.Dir(testDirPath);
		dir.closeSync();
		expect(() => dir.readSync()).toThrow('Can not use closed Dir');
	});

	test('Dir asynchronous iteration', async () => {
		const dir = new fs.Dir(testDirPath);
		const dirents: fs.Dirent[] = [];

		for await (const dirent of dir) {
			dirents.push(dirent);
		}

		expect(dirents.length).toBe(2);
		expect(dirents[0]).toBeInstanceOf(fs.Dirent);
		expect(testFiles).toContain(dirents[0].name);
		expect(testFiles).toContain(dirents[1].name);
	});

	test('Dir read after directory is closed', async () => {
		const dir = new fs.Dir(testDirPath);
		await dir.close();
		await expect(dir.read()).rejects.toThrow('Can not use closed Dir');
	});

	test('Dir readSync after directory is closed', () => {
		const dir = new fs.Dir(testDirPath);
		dir.closeSync();
		expect(() => dir.readSync()).toThrow('Can not use closed Dir');
	});

	test('Dir close multiple times', async () => {
		const dir = new fs.Dir(testDirPath);
		await dir.close();
		await dir.close(); // Should not throw an error
		expect(dir['closed']).toBe(true);
	});

	test('Dir closeSync multiple times', () => {
		const dir = new fs.Dir(testDirPath);
		dir.closeSync();
		dir.closeSync(); // Should not throw an error
		expect(dir['closed']).toBe(true);
	});
});
