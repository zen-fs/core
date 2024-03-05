import { backends, fs, configure } from '../common';

describe.each(backends)('%s fs path validation', (name, options) => {
	const configured = configure(options);

	function check(asyncFn: (...args) => Promise<unknown>, syncFn: (...args) => unknown, ...args): void {
		const expected = /Path must be a string without null bytes./;

		if (fs.getMount('/').metadata.synchronous && syncFn) {
			it(`${asyncFn.name} should throw an error for invalid path`, async () => {
				await configured;
				expect(() => {
					syncFn(...args);
				}).toThrow(expected);
			});
		}

		if (asyncFn) {
			it(`${syncFn.name} should throw an error for invalid path`, async () => {
				await configured;
				expect(await asyncFn(...args)).toThrow(expected);
			});
		}
	}

	check(fs.promises.appendFile, fs.appendFileSync, 'foo\u0000bar');
	check(fs.promises.lstat, fs.lstatSync, 'foo\u0000bar');
	check(fs.promises.mkdir, fs.mkdirSync, 'foo\u0000bar', '0755');
	check(fs.promises.open, fs.openSync, 'foo\u0000bar', 'r');
	check(fs.promises.readFile, fs.readFileSync, 'foo\u0000bar');
	check(fs.promises.readdir, fs.readdirSync, 'foo\u0000bar');
	check(fs.promises.realpath, fs.realpathSync, 'foo\u0000bar');
	check(fs.promises.rename, fs.renameSync, 'foo\u0000bar', 'foobar');
	check(fs.promises.rename, fs.renameSync, 'foobar', 'foo\u0000bar');
	check(fs.promises.rmdir, fs.rmdirSync, 'foo\u0000bar');
	check(fs.promises.stat, fs.statSync, 'foo\u0000bar');
	check(fs.promises.truncate, fs.truncateSync, 'foo\u0000bar');
	check(fs.promises.unlink, fs.unlinkSync, 'foo\u0000bar');
	check(fs.promises.writeFile, fs.writeFileSync, 'foo\u0000bar');

	if (fs.getMount('/').metadata.supportsLinks) {
		check(fs.promises.link, fs.linkSync, 'foo\u0000bar', 'foobar');
		check(fs.promises.link, fs.linkSync, 'foobar', 'foo\u0000bar');
		check(fs.promises.readlink, fs.readlinkSync, 'foo\u0000bar');
		check(fs.promises.symlink, fs.symlinkSync, 'foo\u0000bar', 'foobar');
		check(fs.promises.symlink, fs.symlinkSync, 'foobar', 'foo\u0000bar');
	}

	if (fs.getMount('/').metadata.supportsProperties) {
		check(fs.promises.chmod, fs.chmodSync, 'foo\u0000bar', '0644');
		check(fs.promises.chown, fs.chownSync, 'foo\u0000bar', 12, 34);
		check(fs.promises.utimes, fs.utimesSync, 'foo\u0000bar', 0, 0);
	}

	it('should return false for non-existing path', async () => {
		await configured;
		expect(await fs.promises.exists('foo\u0000bar')).toEqual(false);
	});

	it('should return false for non-existing path (sync)', async () => {
		await configured;
		if (!fs.getMount('/').metadata.synchronous) {
			return;
		}
		expect(fs.existsSync('foo\u0000bar')).toBeFalsy();
	});
});
