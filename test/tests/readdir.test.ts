import { fs } from '../common';

describe('Directory Reading', () => {
	it('Cannot call readdir on a file (synchronous)', () => {
		let wasThrown = false;

		try {
			fs.readdirSync('a.js');
		} catch (e) {
			wasThrown = true;
			expect(e.code).toBe('ENOTDIR');
		}
		expect(wasThrown).toBeTruthy();
	});

	it('Cannot call readdir on a non-existent directory (synchronous)', () => {
		let wasThrown = false;

		try {
			fs.readdirSync('/does/not/exist');
		} catch (e) {
			wasThrown = true;
			expect(e.code).toBe('ENOENT');
		}
		expect(wasThrown).toBeTruthy();
	});

	it('Cannot call readdir on a file (asynchronous)', async () => {
		try {
			await fs.promises.readdir('a.js');
		} catch (err) {
			expect(err).toBeTruthy();
			expect(err.code).toBe('ENOTDIR');
		}
	});

	it('Cannot call readdir on a non-existent directory (asynchronous)', async () => {
		try {
			await fs.promises.readdir('/does/not/exist');
		} catch (err) {
			expect(err).toBeTruthy();
			expect(err.code).toBe('ENOENT');
		}
	});
});
