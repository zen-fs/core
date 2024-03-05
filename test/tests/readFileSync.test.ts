import { fs } from '../common';

describe('fs file reading', () => {
	const filepath = 'elipses.txt';

	it('should read file synchronously and verify the content', async () => {
		const content = fs.readFileSync(filepath, 'utf8');

		for (let i = 0; i < content.length; i++) {
			expect(content[i]).toBe('\u2026');
		}

		expect(content.length).toBe(10000);
	});
});
