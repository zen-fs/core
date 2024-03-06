import { fs } from '../common';

describe('File Writing with Custom Mode', () => {
	it('should write file synchronously with custom mode', async () => {
		const file = 'testWriteFileSync.txt';
		const mode = 0o755;

		fs.writeFileSync(file, '123', { mode });

		const content = fs.readFileSync(file, 'utf8');
		expect(content).toBe('123');
		expect(fs.statSync(file).mode & 0o777).toBe(mode);

		fs.unlinkSync(file);
	});

	it('should append to a file synchronously with custom mode', async () => {
		const file = 'testAppendFileSync.txt';
		const mode = 0o755;

		fs.appendFileSync(file, 'abc', { mode });

		const content = fs.readFileSync(file, { encoding: 'utf8' });
		expect(content).toBe('abc');

		expect(fs.statSync(file).mode & 0o777).toBe(mode);

		fs.unlinkSync(file);
	});
});
