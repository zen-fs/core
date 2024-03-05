import { fs } from '../common';

describe('fs.mkdir', () => {
	const pathname1 = 'mkdir-test1';

	it('should create a directory and verify its existence', async () => {
		await fs.promises.mkdir(pathname1);
		const exists = await fs.promises.exists(pathname1);
		expect(exists).toBe(true);
	});

	const pathname2 = 'mkdir-test2';

	it('should create a directory with custom permissions and verify its existence', async () => {
		await fs.promises.mkdir(pathname2, 0o777);
		const exists = await fs.promises.exists(pathname2);
		expect(exists).toBe(true);
	});

	const pathname3 = 'mkdir-test3/again';

	it('should not be able to create multi-level directories', async () => {
		try {
			await fs.promises.mkdir(pathname3, 0o777);
		} catch (err) {
			expect(err).not.toBeNull();
		}
	});
});
