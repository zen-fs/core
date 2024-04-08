import { fs } from './common';

const content = 'Sample content',
	original = 'ABCD';

describe('appendFile', () => {
	test('create an empty file and add content', async () => {
		const filename = 'append.txt';
		try {
			await fs.promises.appendFile(filename, content);
		} catch (e) {
			throw e.message;
		}
		const data = await fs.promises.readFile(filename, 'utf8');
		expect(data).toEqual(content);
	});

	test('append data to a non-empty file', async () => {
		const filename = 'append2.txt';

		await fs.promises.writeFile(filename, original);
		await fs.promises.appendFile(filename, content);
		const data = await fs.promises.readFile(filename, 'utf8');
		expect(data).toEqual(original + content);
	});

	test('append a buffer to the file', async () => {
		const filename = 'append3.txt';

		await fs.promises.writeFile(filename, original);
		await fs.promises.appendFile(filename, content);
		const data = await fs.promises.readFile(filename, 'utf8');
		expect(data).toEqual(original + content);
	});
});
