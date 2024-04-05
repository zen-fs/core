import { join } from '../src/emulation/path';
import { encode } from '../src/utils';
import { fs } from './common';

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

	async function process_file(path: string, fileMode: number): Promise<void> {
		// We can only read a file if we have read permissions on the file.
		try {
			await fs.promises.readFile(path);
			expect(is_readable(fileMode)).toBe(true);
		} catch (err) {
			if (err.code != 'EPERM') {
				throw err;
			}
			expect(is_readable(fileMode)).toBe(false);
		}

		// We can only write to a file if we have write permissions on the file.
		try {
			const handle = await fs.promises.open(path, 'a');
			expect(is_writable(fileMode)).toBe(true);
			await handle.close();
		} catch (err) {
			if (err.code != 'EPERM') {
				throw err;
			}
			
			expect(is_writable(fileMode)).toBe(false);
		}
	}

	async function process_directory(path: string, dirMode: number): Promise<void> {
		try {
			// We can only readdir if we have read permissions on the directory.
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
			if (err.code != 'EPERM') {
				throw err;
			}
			// We can only readdir if we have read permissions on the directory.
			expect(is_readable(dirMode)).toBe(false);
			// We can only write to a new file if we have write permissions in the directory.
			expect(is_writable(dirMode)).toBe(false);
		}
	}

	async function process_item(p: string, parentMode: number): Promise<void> {
		try {
			const stat = await fs.promises.stat(p);
			// Ensure we have execute permissions on parent directory.
			expect(is_executable(parentMode)).toBe(true);

			// Ensure we have execute permissions on parent directory.
			expect(is_executable(parentMode)).toBe(true);

			if (stat.isDirectory()) {
				await process_directory(p, stat.mode);
			} else {
				await process_file(p, stat.mode);
			}
		} catch (err) {
			if (err.code != 'EPERM') {
				throw err;
			}
			// Ensure we do not have execute permissions on parent directory.
			expect(is_executable(parentMode)).toBe(false);
		}
	}

	process_item('/', 0o777);
});
