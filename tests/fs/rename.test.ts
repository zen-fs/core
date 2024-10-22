import assert from 'node:assert';
import { suite, test } from 'node:test';
import { ErrnoError } from '../../src/error.ts';
import { fs } from '../common.ts';

suite('Rename', () => {
	/**
	 * Creates the following directory structure within `dir`:
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
		assert(contents.length === 2);

		const subContents = await fs.promises.readdir(dir + '/_rename_me');
		assert(subContents.length === 1);

		assert(await fs.promises.exists(dir + '/file.dat'));
		assert(await fs.promises.exists(dir + '/_rename_me/lol.txt'));
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

		assert(!(await fs.promises.exists(oldDir)));

		await fs.promises.mkdir(oldDir);
		await populate(oldDir);
		await fs.promises.rename(oldDir, newDir + '/newDir');
	});

	test('rename file', async () => {
		const dir = '/rename_file_test';
		const one = dir + '/fun.ts';
		const two = dir + '/fun2.ts';

		await fs.promises.mkdir(dir);
		await fs.promises.writeFile(one, 'while(1) alert("Hey! Listen!");');
		await fs.promises.rename(one, one);
		await fs.promises.rename(one, two);

		await fs.promises.writeFile(one, 'hey');
		await fs.promises.rename(one, two);

		assert((await fs.promises.readFile(two, 'utf8')) === 'hey');
		assert(!(await fs.promises.exists(one)));
	});

	test('File to Directory and Directory to File Rename', async () => {
		const dir = '/rename_filedir_test';
		const file = '/rename_filedir_test.txt';

		await fs.promises.mkdir(dir);
		await fs.promises.writeFile(file, 'file contents go here');

		await fs.promises.rename(file, dir).catch((error: ErrnoError) => {
			assert(error instanceof ErrnoError);
			assert(error.code === 'EISDIR' || error.code === 'EPERM');
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
			assert(error instanceof ErrnoError);
			assert(error.code === 'EBUSY');
		});
	});
});
