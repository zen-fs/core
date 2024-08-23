import { fs } from '../common.js';

describe('Directory', () => {
	test('mkdir', async () => {
		await fs.promises.mkdir('/one', 0o755);
		await expect(fs.promises.exists('/one')).resolves.toBe(true);
		await expect(fs.promises.mkdir('/one', 0o755)).rejects.toThrow(/EEXIST/);
	});

	test('mkdirSync', () => fs.mkdirSync('/two', 0o000));

	test('mkdir, nested', async () => {
		try {
			await fs.promises.mkdir('/nested/dir');
		} catch (error) {
			expect(error.code).toBe('ENOENT');
		}
		expect(await fs.promises.exists('/nested/dir')).toBe(false);
	});

	test('mkdir, recursive', async () => {
		await expect(fs.promises.mkdir('/recursiveP/A/B', { recursive: true, mode: 0o755 })).resolves.toBe('/recursiveP');
		await expect(fs.promises.mkdir('/recursiveP/A/B/C/D', { recursive: true, mode: 0o777 })).resolves.toBe('/recursiveP/A/B/C');
		await expect(fs.promises.mkdir('/recursiveP/A/B/C/D', { recursive: true, mode: 0o700 })).resolves.toBeUndefined();

		await expect(fs.promises.stat('/recursiveP')).resolves.toMatchObject({ mode: fs.constants.S_IFDIR | 0o755 });
		await expect(fs.promises.stat('/recursiveP/A')).resolves.toMatchObject({ mode: fs.constants.S_IFDIR | 0o755 });
		await expect(fs.promises.stat('/recursiveP/A/B')).resolves.toMatchObject({ mode: fs.constants.S_IFDIR | 0o755 });
		await expect(fs.promises.stat('/recursiveP/A/B/C')).resolves.toMatchObject({ mode: fs.constants.S_IFDIR | 0o777 });
		await expect(fs.promises.stat('/recursiveP/A/B/C/D')).resolves.toMatchObject({ mode: fs.constants.S_IFDIR | 0o777 });
	});

	test('mkdirSync, recursive', () => {
		expect(fs.mkdirSync('/recursiveS/A/B', { recursive: true, mode: 0o755 })).toBe('/recursiveS');
		expect(fs.mkdirSync('/recursiveS/A/B/C/D', { recursive: true, mode: 0o777 })).toBe('/recursiveS/A/B/C');
		expect(fs.mkdirSync('/recursiveS/A/B/C/D', { recursive: true, mode: 0o700 })).toBeUndefined();

		expect(fs.statSync('/recursiveS')).toMatchObject({ mode: fs.constants.S_IFDIR | 0o755 });
		expect(fs.statSync('/recursiveS/A')).toMatchObject({ mode: fs.constants.S_IFDIR | 0o755 });
		expect(fs.statSync('/recursiveS/A/B')).toMatchObject({ mode: fs.constants.S_IFDIR | 0o755 });
		expect(fs.statSync('/recursiveS/A/B/C')).toMatchObject({ mode: fs.constants.S_IFDIR | 0o777 });
		expect(fs.statSync('/recursiveS/A/B/C/D')).toMatchObject({ mode: fs.constants.S_IFDIR | 0o777 });
	});

	test('readdirSync without permission', () => {
		try {
			fs.readdirSync('/two');
		} catch (error) {
			expect(error.code).toBe('EACCES');
		}
	});

	test('rmdir (non-empty)', async () => {
		await fs.promises.mkdir('/rmdirTest');
		await fs.promises.mkdir('/rmdirTest/rmdirTest2');

		try {
			await fs.promises.rmdir('/rmdirTest');
		} catch (error) {
			expect(error.code).toBe('ENOTEMPTY');
		}
	});

	test('readdirSync on file', () => {
		let wasThrown = false;

		try {
			fs.readdirSync('a.js');
		} catch (e) {
			wasThrown = true;
			expect(e.code).toBe('ENOTDIR');
		}
		expect(wasThrown).toBeTruthy();
	});

	test('readdir on file', async () => {
		try {
			await fs.promises.readdir('a.js');
		} catch (err) {
			expect(err).toBeTruthy();
			expect(err.code).toBe('ENOTDIR');
		}
	});

	test('readdirSync on non-existant directory', () => {
		let wasThrown = false;

		try {
			fs.readdirSync('/does/not/exist');
		} catch (e) {
			wasThrown = true;
			expect(e.code).toBe('ENOENT');
		}
		expect(wasThrown).toBeTruthy();
	});

	test('readdir on non-existant directory', async () => {
		try {
			await fs.promises.readdir('/does/not/exist');
		} catch (err) {
			expect(err).toBeTruthy();
			expect(err.code).toBe('ENOENT');
		}
	});

	test('rm recursively asynchronously', async () => {
		await fs.promises.mkdir('/rmDirRecusrively');
		await fs.promises.mkdir('/rmDirRecusrively/rmDirNested');
		await fs.promises.writeFile('/rmDirRecusrively/rmDirNested/test.txt', 'hello world!');

		await fs.promises.rm('/rmDirRecusrively', { recursive: true });
	});

	test('rm recursively synchronously', async () => {
		fs.mkdirSync('/rmDirRecusrively');
		fs.mkdirSync('/rmDirRecusrively/rmDirNested');
		fs.writeFileSync('/rmDirRecusrively/rmDirNested/test.txt', 'hello world!');

		fs.rmSync('/rmDirRecusrively', { recursive: true });
	});
});
