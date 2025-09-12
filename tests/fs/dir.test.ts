// SPDX-License-Identifier: LGPL-3.0-or-later
import { sync, type Dirent } from '@zenfs/core';
import assert, { rejects } from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

const testFile = 'test-file.txt';
fs.writeFileSync(testFile, 'Sample content');
fs.mkdirSync('test-directory');
fs.symlinkSync(testFile, 'test-symlink');
const testDirPath = 'test-dir';
const testFiles = ['file1.txt', 'file2.txt'];
fs.mkdirSync(testDirPath);
for (const file of testFiles) {
	fs.writeFileSync(`${testDirPath}/${file}`, 'Sample content');
}
await sync();

suite('Dir', () => {
	test('read()', async () => {
		const dir = fs.opendirSync(testDirPath);

		const dirent1 = await dir.read();
		assert(dirent1 instanceof fs.Dirent);
		assert(testFiles.includes(dirent1?.name));

		const dirent2 = await dir.read();
		assert(dirent2 instanceof fs.Dirent);
		assert(testFiles.includes(dirent2?.name));

		const dirent3 = await dir.read();
		assert.equal(dirent3, null);

		await dir.close();
	});

	test('readSync()', () => {
		const dir = fs.opendirSync(testDirPath);

		const dirent1 = dir.readSync();
		assert(dirent1 instanceof fs.Dirent);
		assert(testFiles.includes(dirent1?.name));

		const dirent2 = dir.readSync();
		assert(dirent2 instanceof fs.Dirent);
		assert(testFiles.includes(dirent2?.name));

		const dirent3 = dir.readSync();
		assert.equal(dirent3, null);

		dir.closeSync();
	});

	test('close()', async () => {
		const dir = fs.opendirSync(testDirPath);
		await dir.close();
		rejects(dir.read());
	});

	test('closeSync()', () => {
		const dir = fs.opendirSync(testDirPath);
		dir.closeSync();
		assert.throws(() => dir.readSync());
	});

	test('asynchronous iteration', async () => {
		const dir = fs.opendirSync(testDirPath);
		const dirents: Dirent[] = [];

		for await (const dirent of dir) {
			dirents.push(dirent);
		}

		assert.equal(dirents.length, 2);
		assert(dirents[0] instanceof fs.Dirent);
		assert(testFiles.includes(dirents[0].name));
		assert(testFiles.includes(dirents[1].name));
	});

	test('read after directory is closed', async () => {
		const dir = fs.opendirSync(testDirPath);
		await dir.close();
		await assert.rejects(dir.read());
	});

	test('readSync after directory is closed', () => {
		const dir = fs.opendirSync(testDirPath);
		dir.closeSync();
		assert.throws(() => dir.readSync());
	});

	test('close multiple times', async () => {
		const dir = fs.opendirSync(testDirPath);
		await dir.close();
		await dir.close(); // Should not throw an error
		assert(dir['closed']);
	});

	test('closeSync multiple times', () => {
		const dir = fs.opendirSync(testDirPath);
		dir.closeSync();
		dir.closeSync(); // Should not throw an error
		assert(dir['closed']);
	});
});
