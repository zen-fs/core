import { fs } from '../common';

describe('Directory Removal', () => {
	it('Cannot remove non-empty directories', async () => {
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
