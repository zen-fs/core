import { suite, test } from 'node:test';
import assert from 'node:assert';
import { configure } from '../src/config.js';
import * as fs from '../src/emulation/index.js';
import { S_IFCHR, S_IFMT } from '../src/emulation/constants.js';

console.log(fs.mounts);

await configure({
	addDevices: true,
});

suite('Devices', () => {
	test('Correct file type', () => {
		assert.equal(fs.statSync('/dev/null').mode & S_IFMT, S_IFCHR);
	});

	test('Read from /dev/zero', () => {
		const data = new Uint8Array(100).fill(1);

		const fd = fs.openSync('/dev/zero', 'r');
		fs.readSync(fd, data);
		fs.closeSync(fd);

		assert(data.every(v => v === 0));
	});

	test('Write to /dev/full (throws)', () => {
		assert.throws(() => fs.writeFileSync('/dev/full', '...'), { code: 'ENOSPC' });
	});
});
