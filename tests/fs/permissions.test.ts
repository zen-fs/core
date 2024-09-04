import { R_OK, W_OK, X_OK } from '../../src/emulation/constants.js';
import { join } from '../../src/emulation/path.js';
import { cred } from '../../src/emulation/shared.js';
import { ErrnoError } from '../../src/error.js';
import { encode } from '../../src/utils.js';
import { fs } from '../common.js';

describe('Permissions', () => {
	async function test_item(path: string): Promise<void> {
		const stats = await fs.promises.stat(path).catch((error: ErrnoError) => {
			expect(error).toBeInstanceOf(ErrnoError);
			expect(error.code).toBe('EACCES');
		});
		if (!stats) {
			return;
		}
		expect(stats.hasAccess(X_OK, cred)).toBe(true);

		function checkError(access: number) {
			return function (error: ErrnoError) {
				expect(error).toBeInstanceOf(ErrnoError);
				expect(error);
				expect(stats!.hasAccess(access, cred)).toBe(false);
			};
		}

		if (stats.isDirectory()) {
			for (const dir of await fs.promises.readdir(path)) {
				await test_item(join(path, dir));
			}
		} else {
			await fs.promises.readFile(path).catch(checkError(R_OK));
		}
		expect(stats.hasAccess(R_OK, cred)).toBe(true);

		if (stats.isDirectory()) {
			const testFile = join(path, '__test_file_plz_ignore.txt');
			await fs.promises.writeFile(testFile, encode('this is a test file, please ignore.')).catch(checkError(W_OK));
			await fs.promises.unlink(testFile).catch(checkError(W_OK));
		} else {
			const handle = await fs.promises.open(path, 'a').catch(checkError(W_OK));
			if (!handle) {
				return;
			}
			await handle.close();
		}
		expect(stats.hasAccess(R_OK, cred)).toBe(true);
	}

	test('recursive', () => test_item('/'));
});
