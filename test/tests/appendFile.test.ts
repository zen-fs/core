import { backends, fs, configure, tmpDir } from '../common';
import * as path from 'path';

import type { FileContents } from '../../src/filesystem';
import { jest } from '@jest/globals';
import { encode } from '../../src';

describe.each(backends)('%s.appendFile', (name, options) => {
	const configured = configure(options);
	const tmpFile: string = path.join(tmpDir, 'append.txt');

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should create an empty file and add content', async () => {
		await configured;
		const filename = path.join(tmpFile, 'append.txt');
		const content = 'Sample content';

		jest.spyOn(fs, 'appendFile').mockImplementation((file, data, mode) => {
			expect(file).toBe(filename);
			expect(data).toBe(content);
		});

		await appendFileAndVerify(filename, content);
	});

	it('should append data to a non-empty file', async () => {
		await configured;
		const filename = path.join(tmpFile, 'append2.txt');
		const content = 'Sample content';

		await fs.promises.writeFile(filename, 'ABCD');

		jest.spyOn(fs, 'appendFile').mockImplementation((file, data, mode) => {
			expect(file).toBe(filename);
			expect(data).toBe(content);
		});

		await appendFileAndVerify(filename, content);
	});

	it('should append a buffer to the file', async () => {
		await configured;
		const filename = path.join(tmpFile, 'append3.txt');
		const currentFileData = 'ABCD';
		const content = encode('Sample content', 'utf8');

		await fs.promises.writeFile(filename, currentFileData);

		jest.spyOn(fs, 'appendFile').mockImplementation((file, data, mode) => {
			expect(file).toBe(filename);
			expect(data).toBe(content);
		});

		await appendFileAndVerify(filename, content);
	});

	async function appendFileAndVerify(filename: string, content: FileContents): Promise<void> {
		await fs.promises.appendFile(filename, content);

		const data = await fs.promises.readFile(filename, 'utf8');
		expect(data).toEqual(content.toString());
	}
});
