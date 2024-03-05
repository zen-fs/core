import { fs } from '../common';
import { jest } from '@jest/globals';

describe('File Writing with Custom Mode', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should write file synchronously with custom mode', async () => {
		const file = 'testWriteFileSync.txt';
		const mode = 0o755;

		jest.spyOn(fs, 'openSync').mockImplementation((...args) => {
			return fs.openSync.apply(fs, args);
		});

		jest.spyOn(fs, 'closeSync').mockImplementation((...args) => {
			return fs.closeSync.apply(fs, args);
		});

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

		jest.spyOn(fs, 'openSync').mockImplementation((...args) => {
			return fs.openSync.apply(fs, args);
		});

		jest.spyOn(fs, 'closeSync').mockImplementation((...args) => {
			return fs.closeSync.apply(fs, args);
		});

		fs.appendFileSync(file, 'abc', { mode: mode });

		const content = fs.readFileSync(file, { encoding: 'utf8' });
		expect(content).toBe('abc');

		expect(fs.statSync(file).mode & mode).toBe(mode);

		fs.unlinkSync(file);
	});
});
