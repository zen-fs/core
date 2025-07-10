import assert from 'node:assert/strict';
import { after, suite, test } from 'node:test';
import { wait } from 'utilium';
import { constants, type FileHandle, open } from '../../dist/vfs/promises.js';

const content = 'The cake is a lie',
	appended = '\nAnother lie';

const handle: FileHandle = await open('./test.txt', 'ws+');

suite('FileHandle', () => {
	test('writeFile', async () => {
		await handle.writeFile(content);
		await handle.sync();
	});

	test('readFile', async () => {
		assert.equal(await handle.readFile('utf8'), content);
	});

	test('appendFile', async () => {
		await handle.appendFile(appended);
	});

	test('readFile after appendFile', async () => {
		assert.equal(await handle.readFile({ encoding: 'utf8' }), content + appended);
	});

	test('truncate', async () => {
		await handle.truncate(5);
		assert.equal(await handle.readFile({ encoding: 'utf8' }), content.slice(0, 5));
	});

	test('stat', async () => {
		const stats = await handle.stat();
		assert(stats.isFile());
	});

	test('chmod', async () => {
		await handle.chmod(constants.S_IRUSR | constants.S_IWUSR);
		const stats = await handle.stat();
		assert(stats.mode & constants.S_IRUSR);
		assert(stats.mode & constants.S_IWUSR);
	});

	test('chown', async () => {
		await handle.chown(1234, 5678);
		const stats = await handle.stat();
		assert.equal(stats.uid, 1234);
		assert.equal(stats.gid, 5678);
	});

	test('readLines', async () => {
		await handle.writeFile('first line\nsecond line\nthird line');

		await using rl = handle.readLines();

		const lines: string[] = [];
		rl.on('line', (line: string) => lines.push(line));

		await wait(50);

		assert.deepEqual(lines, ['first line', 'second line', 'third line']);
	});
});

after(() => handle.close());
