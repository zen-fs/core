import { join } from '../../src/emulation/path';
import { encode } from '../../src/utils';
import { fs } from '../common';

describe('permissions test', () => {
	const testFileContents = encode('this is a test file, plz ignore.');

	function is_writable(mode: number) {
		return (mode & 0o222) > 0;
	}

	function is_readable(mode: number) {
		return (mode & 0o444) > 0;
	}

	function is_executable(mode: number) {
		return (mode & 0o111) > 0;
	}

	async function process_file(p: string, fileMode: number): Promise<void> {
		try {
			const data = await fs.promises.readFile(p);
			// Invariant 2: We can only read a file if we have read permissions on the file.
			expect(is_readable(fileMode)).toBe(true);
		} catch (err) {
			if (err.code === 'EPERM') {
				// Invariant 2: We can only read a file if we have read permissions on the file.
				expect(is_readable(fileMode)).toBe(false);
			} else {
				throw err;
			}
		}

		try {
			const fd = await fs.promises.open(p, 'a');
			// Invariant 3: We can only write to a file if we have write permissions on the file.
			expect(is_writable(fileMode)).toBe(true);
			await fd.close();
		} catch (err) {
			if (err.code === 'EPERM') {
				// Invariant 3: We can only write to a file if we have write permissions on the file.
				expect(is_writable(fileMode)).toBe(false);
			} else {
				throw err;
			}
		}
	}

	async function process_directory(path: string, dirMode: number): Promise<void> {
		try {
			// Invariant 2: We can only readdir if we have read permissions on the directory.
			expect(is_readable(dirMode)).toBe(true);

			for (const dir of await fs.promises.readdir(path)) {
				await process_item(join(path, dir), dirMode);
			}

			// Try to write a file into the directory.
			const testFile = join(path, '__test_file_plz_ignore.txt');
			await fs.promises.writeFile(testFile, testFileContents);
			// Clean up.
			await fs.promises.unlink(testFile);
		} catch (err) {
			if (err.code === 'EPERM') {
				// Invariant 2: We can only readdir if we have read permissions on the directory.
				expect(is_readable(dirMode)).toBe(false);
				// Invariant 3: We can only write to a new file if we have write permissions in the directory.
				expect(is_writable(dirMode)).toBe(false);
			} else {
				throw err;
			}
		}
	}

	async function process_item(p: string, parentMode: number): Promise<void> {
		try {
			const stat = await fs.promises.stat(p);
			// Invariant 4: Ensure we have execute permissions on parent directory.
			expect(is_executable(parentMode)).toBe(true);

			// Invariant 4: Ensure we have execute permissions on parent directory.
			expect(is_executable(parentMode)).toBe(true);

			if (stat.isDirectory()) {
				await process_directory(p, stat.mode);
			} else {
				await process_file(p, stat.mode);
			}
		} catch (err) {
			if (err.code === 'EPERM') {
				// Invariant 4: Ensure we do not have execute permissions on parent directory.
				expect(is_executable(parentMode)).toBe(false);
			} else {
				throw err;
			}
		}
	}

	test('satisfy the permissions invariants', async () => {
		await process_item('/', 0o777);
	});
});
