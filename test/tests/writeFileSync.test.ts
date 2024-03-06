import { fs } from '../common';

describe('File Writing with Custom Mode', () => {

	it('should write file synchronously with custom mode', async () => {
		const file = 'testWriteFileSync.txt';
		const mode = 0o755;

		fs.writeFileSync(file, '123', { mode: mode });

		const content = fs.readFileSync(file, { encoding: 'utf8' });
		expect(content).toBe('123');

		const actual = fs.statSync(file).mode & 0o777;
		expect(actual).toBe(mode);

		fs.unlinkSync(file);
	});

	it('should append to a file synchronously with custom mode', async () => {
		const file = 'testAppendFileSync.txt';
		const mode = 0o755;

		fs.appendFileSync(file, 'abc', { mode: mode });

		const content = fs.readFileSync(file, { encoding: 'utf8' });
		expect(content).toBe('abc');

		expect(fs.statSync(file).mode & mode).toBe(mode);

		fs.unlinkSync(file);
	});
});
