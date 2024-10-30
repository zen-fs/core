import assert from 'node:assert';
import { suite, test } from 'node:test';
import { R_OK, W_OK, X_OK } from '../../dist/emulation/constants.js';
import { join } from '../../dist/emulation/path.js';
import { ErrnoError } from '../../dist/error.js';
import { encodeUTF8 } from '../../dist/utils.js';
import { fs } from '../common.js';

suite('Permissions', () => {
	async function test_item(path: string): Promise<void> {
		const stats = await fs.promises.stat(path).catch((error: ErrnoError) => {
			assert(error instanceof ErrnoError);
			assert(error.code === 'EACCES');
		});
		if (!stats) {
			return;
		}
		assert(stats.hasAccess(X_OK));

		function checkError(access: number) {
			return function (error: ErrnoError) {
				assert(error instanceof ErrnoError);
				assert(error);
				assert(!stats!.hasAccess(access));
			};
		}

		if (stats.isDirectory()) {
			for (const dir of await fs.promises.readdir(path)) {
				await test_item(join(path, dir));
			}
		} else {
			await fs.promises.readFile(path).catch(checkError(R_OK));
		}
		assert(stats.hasAccess(R_OK));

		if (stats.isDirectory()) {
			const testFile = join(path, '__test_file_plz_ignore.txt');
			await fs.promises.writeFile(testFile, encodeUTF8('this is a test file, please ignore.')).catch(checkError(W_OK));
			await fs.promises.unlink(testFile).catch(checkError(W_OK));
		} else {
			const handle = await fs.promises.open(path, 'a').catch(checkError(W_OK));
			if (!handle) {
				return;
			}
			await handle.close();
		}
		assert(stats.hasAccess(R_OK));
	}

	test('recursive', () => test_item('/'));
});
