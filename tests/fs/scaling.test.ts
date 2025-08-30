import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { sync } from '../../dist/config.js';
import { fs } from '../common.js';

const n_files = 130;
const huge_size = 0x1000000;

// Tests for having a lot of various things (number of inodes/files, individual file size, etc.).
suite('Scaling', () => {
	test('Lots of inodes/files', async () => {
		fs.mkdirSync('/n');

		for (let i = 0; i < n_files; i++) {
			fs.writeFileSync('/n/' + i, i.toString(16));
		}

		await sync();
		assert.equal(fs.readdirSync('/n').length, n_files);

		const results = [];

		for (let i = 0; i < n_files; i++) {
			results.push(fs.promises.readFile('/n/' + i, 'utf8').then(val => assert.equal(val, i.toString(16))));
		}

		await Promise.all(results);
	});

	test('Singular file size', () => {
		fs.writeFileSync('/huge', new Uint8Array(huge_size));
		assert.equal(fs.statSync('/huge').size, huge_size);
	});
});
