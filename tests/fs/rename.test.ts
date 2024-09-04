import { ErrnoError } from '../../src/error.js';
import { fs } from '../common.js';

describe('Rename', () => {
	/**
	 * Creates the following directory structure within the given dir:
	 * - _rename_me
	 *   - lol.txt
	 * - file.dat
	 */
	async function populate(dir: string) {
		await fs.promises.mkdir(dir + '/_rename_me');
		await fs.promises.writeFile(dir + '/file.dat', 'filedata');
		await fs.promises.writeFile(dir + '/_rename_me/lol.txt', 'lololol');
	}

	/**
	 * Check that the directory structure created in populate_directory remains.
	 */
	async function check_directory(dir: string) {
		const contents = await fs.promises.readdir(dir);
		expect(contents.length).toBe(2);

		const subConents = await fs.promises.readdir(dir + '/_rename_me');
		expect(subConents.length).toBe(1);

		expect(await fs.promises.exists(dir + '/file.dat')).toBe(true);
		expect(await fs.promises.exists(dir + '/_rename_me/lol.txt')).toBe(true);
	}

	test('rename directory', async () => {
		const oldDir = '/rename_test';
		const newDir = '/rename_test2';

		await fs.promises.mkdir(oldDir);

		await populate(oldDir);

		await fs.promises.rename(oldDir, oldDir);

		await check_directory(oldDir);

		await fs.promises.rename(oldDir, newDir);

		await check_directory(newDir);

		expect(await fs.promises.exists(oldDir)).toBe(false);

		await fs.promises.mkdir(oldDir);
		await populate(oldDir);
		await fs.promises.rename(oldDir, newDir + '/newDir');
	});

	test('rename file', async () => {
		const dir = '/rename_file_test';
		const one = dir + '/fun.js';
		const two = dir + '/fun2.js';

		await fs.promises.mkdir(dir);
		await fs.promises.writeFile(one, 'while(1) alert("Hey! Listen!");');
		await fs.promises.rename(one, one);
		await fs.promises.rename(one, two);

		await fs.promises.writeFile(one, 'hey');
		await fs.promises.rename(one, two);

		expect(await fs.promises.readFile(two, 'utf8')).toBe('hey');
		expect(await fs.promises.exists(one)).toBe(false);
	});

	test('File to Directory and Directory to File Rename', async () => {
		const dir = '/rename_filedir_test';
		const file = '/rename_filedir_test.txt';

		await fs.promises.mkdir(dir);
		await fs.promises.writeFile(file, 'file contents go here');

		await fs.promises.rename(file, dir).catch((error: ErrnoError) => {
			expect(error).toBeInstanceOf(ErrnoError);
			expect(error.code === 'EISDIR' || error.code === 'EPERM').toBe(true);
		});

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

	test('rename directory inside itself', async () => {
		const renDir1 = '/renamedir_1';
		const renDir2 = '/renamedir_1/lol';

		await fs.promises.mkdir(renDir1);

		await fs.promises.rename(renDir1, renDir2).catch((error: ErrnoError) => {
			expect(error).toBeInstanceOf(ErrnoError);
			expect(error.code).toBe('EBUSY');
		});
	});
});
