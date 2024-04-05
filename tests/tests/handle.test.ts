import { type FileHandle, open, constants } from '../../src/emulation/promises';

const content = 'The cake is a lie',
	appended = '\nAnother lie';

describe('FileHandle', () => {
	let handle: FileHandle;
	const filePath = './test.txt';

	test('open', async () => {
		handle = await open(filePath, 'w+');
	});

	test('writeFile', async () => {
		await handle.writeFile(content);
	});

	test('readFile', async () => {
		expect(await handle.readFile('utf8')).toBe(content);
	});

	test('appendFile', async () => {
		await handle.appendFile(appended);
	});

	test('readFile after appendFile', async () => {
		expect(await handle.readFile({ encoding: 'utf8' })).toBe(content + appended);
	});

	test('truncate', async () => {
		await handle.truncate(5);
		expect(await handle.readFile({ encoding: 'utf8' })).toBe(content.slice(0, 5));
	});

	test('stat', async () => {
		const stats = await handle.stat();
		expect(stats.isFile()).toBe(true);
	});

	test('chmod', async () => {
		await handle.chmod(constants.S_IRUSR | constants.S_IWUSR);
		const stats = await handle.stat();
		expect(stats.mode & constants.S_IRUSR).toBeTruthy();
		expect(stats.mode & constants.S_IWUSR).toBeTruthy();
	});

	test('chown', async () => {
		await handle.chown(1234, 5678);
		const stats = await handle.stat();
		expect(stats.uid).toBe(1234);
		expect(stats.gid).toBe(5678);
	});

	test('close', async () => {
		await handle.close();
	});
});
