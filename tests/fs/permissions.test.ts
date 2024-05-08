import type { Stats } from '../../src/stats.js';
import { join } from '../../src/emulation/path.js';
import { encode } from '../../src/utils.js';
import { fs } from '../common.js';
import { R_OK, W_OK, X_OK } from '../../src/emulation/constants.js';
import { cred } from '../../src/emulation/shared.js';

describe('Permissions', () => {
	async function test_item(path: string): Promise<void> {
		let stats: Stats;

		try {
			stats = await fs.promises.stat(path);
			expect(stats.hasAccess(X_OK, cred)).toBe(true);
		} catch (err) {
			if (err.code != 'EACCES') {
				throw err;
			}
			expect(stats.hasAccess(X_OK, cred)).toBe(false);
		}

		try {
			if (!stats.isDirectory()) {
				await fs.promises.readFile(path);
			} else {
				for (const dir of await fs.promises.readdir(path)) {
					await test_item(join(path, dir));
				}
			}
			expect(stats.hasAccess(R_OK, cred)).toBe(true);
		} catch (err) {
			if (err.code != 'EACCES') {
				throw err;
			}
			expect(stats.hasAccess(R_OK, cred)).toBe(false);
		}

		try {
			if (!stats.isDirectory()) {
				const handle = await fs.promises.open(path, 'a');
				expect(stats.hasAccess(W_OK, cred)).toBe(true);
				await handle.close();
			} else {
				const testFile = join(path, '__test_file_plz_ignore.txt');
				await fs.promises.writeFile(testFile, encode('this is a test file, please ignore.'));
				await fs.promises.unlink(testFile);
			}

			expect(stats.hasAccess(R_OK, cred)).toBe(true);
		} catch (err) {
			if (err.code != 'EACCES') {
				throw err;
			}

			expect(stats.hasAccess(W_OK, cred)).toBe(false);
		}
	}

	test('recursive', () => test_item('/'));
});
