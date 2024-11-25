import { suite, test } from 'node:test';
import assert from 'node:assert';
import { bindContext } from '../dist/context.js';
import * as fs from '../dist/emulation/index.js';

fs.mkdirSync('/new_root');
const c_fs = bindContext('/new_root');

suite('Context', () => {
	test('create a file', () => {
		c_fs.writeFileSync('/example.txt', 'not in real root!');
		assert.deepEqual(fs.readdirSync('/'), ['new_root']);
		assert.deepEqual(fs.readdirSync('/new_root'), ['example.txt']);
	});

	test('break-out fails', () => {
		assert.deepEqual(c_fs.readdirSync('/../../'), ['example.txt']);
	});
});
