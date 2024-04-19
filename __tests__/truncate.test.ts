import type { FileHandle } from '../src/emulation/promises';
import { fs } from '../test-utils/common';

const path: string = 'truncate-file.txt',
	size = 1024 * 16,
	data = new Uint8Array(size).fill('x'.charCodeAt(0));

describe('Truncate, sync', () => {
	test('initial write', () => {
		fs.writeFileSync(path, data);
		expect(fs.statSync(path).size).toBe(size);
	});

	test('truncate to 1024', () => {
		fs.truncateSync(path, 1024);
		expect(fs.statSync(path).size).toBe(1024);
	});

	test('truncate to 0', () => {
		fs.truncateSync(path);
		expect(fs.statSync(path).size).toBe(0);
	});

	test('write', () => {
		fs.writeFileSync(path, data);
		expect(fs.statSync(path).size).toBe(size);
	});

	let fd: number;
	test('open r+', () => {
		fd = fs.openSync(path, 'r+');
	});

	test('ftruncate to 1024', () => {
		fs.ftruncateSync(fd, 1024);
		expect(fs.fstatSync(fd).size).toBe(1024);
	});

	test('ftruncate to 0', () => {
		fs.ftruncateSync(fd);
		expect(fs.fstatSync(fd).size).toBe(0);
	});

	test('close fd', () => {
		fs.closeSync(fd);
	});
});
describe('Truncate, async', () => {
	const statSize = async (path: string) => (await fs.promises.stat(path)).size;

	test('initial write', async () => {
		await fs.promises.writeFile(path, data);

		expect(await statSize(path)).toBe(1024 * 16);
	});

	test('truncate to 1024', async () => {
		await fs.promises.truncate(path, 1024);
		expect(await statSize(path)).toBe(1024);
	});

	test('truncate to 0', async () => {
		await fs.promises.truncate(path);
		expect(await statSize(path)).toBe(0);
	});

	test('write', async () => {
		await fs.promises.writeFile(path, data);
		expect(await statSize(path)).toBe(size);
	});

	let handle: FileHandle;
	test('open w', async () => {
		handle = await fs.promises.open(path, 'w');
	});

	test('handle.truncate to 1024', async () => {
		await handle.truncate(1024);
		await handle.sync();
		expect(await statSize(path)).toBe(1024);
	});

	test('handle.truncate to 0', async () => {
		await handle.truncate();
		await handle.sync();
		expect(await statSize(path)).toBe(0);
	});

	test('close handle', async () => {
		await handle.close();
	});
});
