import { fs } from './common';

describe('Directory', () => {
	test('mkdir', async () => {
		await fs.promises.mkdir('/one', 0o755);
		expect(await fs.promises.exists('/one')).toBe(true);
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
});
