import { backends, fs, configure } from '../common';

describe.each(backends)('%s Directory Removal', (name, options) => {
	const configured = configure(options);

	it('Cannot remove non-empty directories', async () => {
		await configured;

		await fs.promises.mkdir('/rmdirTest');
		await fs.promises.mkdir('/rmdirTest/rmdirTest2');

		try {
			await fs.promises.rmdir('/rmdirTest');
		} catch (err) {
			expect(err).not.toBeNull();
			expect(err.code).toBe('ENOTEMPTY');
		}
	});
});
