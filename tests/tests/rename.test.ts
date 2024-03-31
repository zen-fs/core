import { fs } from '../common';
import * as path from 'path';

describe('File and Directory Rename Tests', () => {
	/**
	 * Creates the following directory structure within the given dir:
	 * - _rename_me
	 *   - lol.txt
	 * - file.dat
	 */
	async function populate_directory(dir) {
		const dir1 = path.resolve(dir, '_rename_me');
		const file1 = path.resolve(dir, 'file.dat');
		const file2 = path.resolve(dir1, 'lol.txt');

		await fs.promises.mkdir(dir1);
		await fs.promises.writeFile(file1, Buffer.from('filedata'));
		await fs.promises.writeFile(file2, Buffer.from('lololol'));
	}

	/**
	 * Check that the directory structure created in populate_directory remains.
	 */
	async function check_directory(dir) {
		const dir1 = path.resolve(dir, '_rename_me');
		const file1 = path.resolve(dir, 'file.dat');
		const file2 = path.resolve(dir1, 'lol.txt');

		const contents = await fs.promises.readdir(dir);
		expect(contents.length).toBe(2);

		const contentsDir1 = await fs.promises.readdir(dir1);
		expect(contentsDir1.length).toBe(1);

		const existsFile1 = await fs.promises.exists(file1);
		expect(existsFile1).toBe(true);

		const existsFile2 = await fs.promises.exists(file2);
		expect(existsFile2).toBe(true);
	}

	it('Directory Rename', async () => {
		const oldDir = '/rename_test';
		const newDir = '/rename_test2';

		await fs.promises.mkdir(oldDir);

		await populate_directory(oldDir);

		await fs.promises.rename(oldDir, oldDir);

		await check_directory(oldDir);

		await fs.promises.mkdir(newDir);
		await fs.promises.rmdir(newDir);
		await fs.promises.rename(oldDir, newDir);

		await check_directory(newDir);

		const exists = await fs.promises.exists(oldDir);
		expect(exists).toBe(false);

		await fs.promises.mkdir(oldDir);
		await populate_directory(oldDir);
		await fs.promises.rename(oldDir, path.resolve(newDir, 'newDir'));
	});

	it('File Rename', async () => {
		const fileDir = '/rename_file_test';
		const file1 = path.resolve(fileDir, 'fun.js');
		const file2 = path.resolve(fileDir, 'fun2.js');

		await fs.promises.mkdir(fileDir);
		await fs.promises.writeFile(file1, Buffer.from('while(1) alert("Hey! Listen!");'));
		await fs.promises.rename(file1, file1);
		await fs.promises.rename(file1, file2);

		await fs.promises.writeFile(file1, Buffer.from('hey'));
		await fs.promises.rename(file1, file2);

		const contents = await fs.promises.readFile(file2);
		expect(contents.toString()).toBe('hey');

		const exists = await fs.promises.exists(file1);
		expect(exists).toBe(false);
	});

	it('File to Directory and Directory to File Rename', async () => {
		const dir = '/rename_filedir_test';
		const file = '/rename_filedir_test.txt';

		await fs.promises.mkdir(dir);
		await fs.promises.writeFile(file, Buffer.from('file contents go here'));

		try {
			await fs.promises.rename(file, dir);
		} catch (e) {
			// Some *native* file systems throw EISDIR, others throw EPERM.... accept both.
			expect(e.code === 'EISDIR' || e.code === 'EPERM').toBe(true);
		}

		// JV: Removing test for now. I noticed that you can do that in Node v0.12 on Mac,
		// but it might be FS independent.
		/*fs.rename(dir, file, function (e) {
		  if (e == null) {
			throw new Error("Failed invariant: Cannot rename a directory over a file.");
		  } else {
			assert(e.code === 'ENOTDIR');
		  }
		});*/
	});

	it('Cannot Rename a Directory Inside Itself', async () => {
		const renDir1 = '/renamedir_1';
		const renDir2 = '/renamedir_1/lol';

		await fs.promises.mkdir(renDir1);

		try {
			await fs.promises.rename(renDir1, renDir2);
		} catch (e) {
			expect(e.code).toBe('EBUSY');
		}
	});
});
