import { backends, fs, configure, fixturesDir } from '../common';
import path from 'path';

describe.each(backends)('%s fs file opening', (name, options) => {
	const configured = configure(options);
	const filename = path.join(fixturesDir, 'a.js');

	it('should throw ENOENT when opening non-existent file (sync)', async () => {
		await configured;

		if (fs.getMount('/').metadata.synchronous) {
			let caughtException = false;
			try {
				fs.openSync('/path/to/file/that/does/not/exist', 'r');
			} catch (e) {
				expect(e?.code).toBe('ENOENT');
				caughtException = true;
			}
			expect(caughtException).toBeTruthy();
		}
	});

	it('should throw ENOENT when opening non-existent file (async)', async () => {
		await configured;
		try {
			await fs.promises.open('/path/to/file/that/does/not/exist', 'r');
		} catch (e) {
			expect(e?.code).toBe('ENOENT');
		}
	});

	it('should open file with mode "r"', async () => {
		await configured;
		const fd = await fs.promises.open(filename, 'r');
		expect(fd).toBeGreaterThanOrEqual(-Infinity);
	});

	it('should open file with mode "rs"', async () => {
		await configured;
		const fd = await fs.promises.open(filename, 'rs');
		expect(fd).toBeGreaterThanOrEqual(-Infinity);
	});
});
