import { fs } from '../common';

describe('fs.exists', () => {
	const f = 'x.txt';

	it('should return true for an existing file', async () => {
		const exists = await fs.promises.exists(f);
		expect(exists).toBe(true);
	});

	it('should return false for a non-existent file', async () => {
		const exists = await fs.promises.exists(f + '-NO');
		expect(exists).toBe(false);
	});

	it('should have sync methods that behave the same', async () => {
		expect(fs.existsSync(f)).toBe(true);
		expect(fs.existsSync(f + '-NO')).toBe(false);
	});
});
