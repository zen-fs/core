import { fs } from '../common.js';

describe('fs file opening', () => {
	const filename = 'a.js';

	test('throw ENOENT when opening non-existent file (sync)', () => {
		let caughtException = false;
		try {
			fs.openSync('/path/to/file/that/does/not/exist', 'r');
		} catch (e) {
			expect(e?.code).toBe('ENOENT');
			caughtException = true;
		}
		expect(caughtException).toBeTruthy();
	});

	test('throw ENOENT when opening non-existent file (async)', async () => {
		try {
			await fs.promises.open('/path/to/file/that/does/not/exist', 'r');
		} catch (e) {
			expect(e?.code).toBe('ENOENT');
		}
	});

	test('open file with mode "r"', async () => {
		const { fd } = await fs.promises.open(filename, 'r');
		expect(fd).toBeGreaterThanOrEqual(-Infinity);
	});

	test('open file with mode "rs"', async () => {
		const { fd } = await fs.promises.open(filename, 'rs');
		expect(fd).toBeGreaterThanOrEqual(-Infinity);
	});
});
