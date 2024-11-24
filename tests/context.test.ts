import { suite, test } from 'node:test';
import assert from 'node:assert';
import { bindContext } from '../src/context.js';
import * as fs from '../src/emulation/index.js';

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
