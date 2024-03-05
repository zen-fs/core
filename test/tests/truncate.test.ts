import { backends, fs, configure, tmpDir, fixturesDir } from '../common';
import * as path from 'path';

describe.each(backends)('%s Truncate Tests', (name, options) => {
	const configured = configure(options);
	let filename: string;
	const data = Buffer.alloc(1024 * 16, 'x');
	let success: number;

	beforeAll(() => {
		const tmp = tmpDir;
		filename = path.resolve(tmp, 'truncate-file.txt');
	});

	beforeEach(() => {
		success = 0;
	});

	afterEach(async () => {
		await fs.promises.unlink(filename);
	});

	it('Truncate Sync', () => {
		if (!fs.getMount('/').metadata.synchronous) return;

		fs.writeFileSync(filename, data);
		expect(fs.statSync(filename).size).toBe(1024 * 16);

		fs.truncateSync(filename, 1024);
		expect(fs.statSync(filename).size).toBe(1024);

		fs.truncateSync(filename);
		expect(fs.statSync(filename).size).toBe(0);

		fs.writeFileSync(filename, data);
		expect(fs.statSync(filename).size).toBe(1024 * 16);

		/* once fs.ftruncateSync is supported.
		const fd = fs.openSync(filename, 'r+');
		fs.ftruncateSync(fd, 1024);
		stat = fs.statSync(filename);
		expect(stat.size).toBe(1024);

		fs.ftruncateSync(fd);
		stat = fs.statSync(filename);
		expect(stat.size).toBe(0);
		
		fs.closeSync(fd);
		*/
	});

	it('Truncate Async', async () => {
		await configured;

		if (fs.getMount('/').metadata.readonly || !fs.getMount('/').metadata.synchronous) {
			return;
		}

		const stat = fs.promises.stat;

		await fs.promises.writeFile(filename, data);
		expect((await stat(filename)).size).toBe(1024 * 16);

		await fs.promises.truncate(filename, 1024);
		expect((await stat(filename)).size).toBe(1024);

		await fs.promises.truncate(filename);
		expect((await stat(filename)).size).toBe(0);

		await fs.promises.writeFile(filename, data);
		expect((await stat(filename)).size).toBe(1024 * 16);

		const fd = await fs.promises.open(filename, 'w');

		await fs.promises.ftruncate(fd, 1024);
		await fs.promises.fsync(fd);
		expect((await stat(filename)).size).toBe(1024);

		await fs.promises.ftruncate(fd);
		await fs.promises.fsync(fd);
		expect((await stat(filename)).size).toBe(0);

		await fs.promises.close(fd);
	});
});
