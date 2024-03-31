import { fs } from '../common';

describe('fs.writeSync', () => {
	it('should write file synchronously with specified content', async () => {
		const fn = 'write.txt';
		const foo = 'foo';
		const fd = fs.openSync(fn, 'w');

		let written = fs.writeSync(fd, '');
		expect(written).toBe(0);

		fs.writeSync(fd, foo);

		const bar = 'bár';
		written = fs.writeSync(fd, Buffer.from(bar), 0, Buffer.byteLength(bar));
		expect(written).toBeGreaterThan(3);

		fs.closeSync(fd);

		expect(fs.readFileSync(fn).toString()).toBe('foobár');
	});
});
