import assert from 'node:assert';
import { suite } from 'node:test';
import type { ErrnoError } from '../../dist/error.js';
import { fs } from '../common.js';

const existingFile = '/exit.js';

suite('Error messages', () => {
	const path = '/non-existent';

	fs.promises.stat(path).catch((error: ErrnoError) => {
		assert.equal(error.toString(), error.message);
		assert.equal(error.bufferSize(), 4 + JSON.stringify(error.toJSON()).length);
	});

	const missing = { path, message: new RegExp(path) };
	const existing = { path: existingFile, message: new RegExp(existingFile) };

	assert.rejects(() => fs.promises.stat(path), missing);
	assert.rejects(() => fs.promises.mkdir(existingFile, 0o666), existing);
	assert.rejects(() => fs.promises.rmdir(path), missing);
	assert.rejects(() => fs.promises.rmdir(existingFile), existing);
	assert.rejects(() => fs.promises.rename(path, 'foo'), missing);
	assert.rejects(() => fs.promises.open(path, 'r'), missing);
	assert.rejects(() => fs.promises.readdir(path), missing);
	assert.rejects(() => fs.promises.unlink(path), missing);
	assert.rejects(() => fs.promises.link(path, 'foo'), missing);
	assert.rejects(() => fs.promises.chmod(path, 0o666), missing);
	assert.rejects(() => fs.promises.lstat(path), missing);
	assert.rejects(() => fs.promises.readlink(path), missing);
	assert.throws(() => fs.statSync(path), missing);
	assert.throws(() => fs.mkdirSync(existingFile, 0o666), existing);
	assert.throws(() => fs.rmdirSync(path), missing);
	assert.throws(() => fs.rmdirSync(existingFile), existing);
	assert.throws(() => fs.renameSync(path, 'foo'), missing);
	assert.throws(() => fs.openSync(path, 'r'), missing);
	assert.throws(() => fs.readdirSync(path), missing);
	assert.throws(() => fs.unlinkSync(path), missing);
	assert.throws(() => fs.linkSync(path, 'foo'), missing);
	assert.throws(() => fs.chmodSync(path, 0o666), missing);
	assert.throws(() => fs.lstatSync(path), missing);
	assert.throws(() => fs.readlinkSync(path), missing);
});
