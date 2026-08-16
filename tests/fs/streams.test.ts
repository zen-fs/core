// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { config, fs } from '../common.ts';

// Top-level initialization
const testFilePath = 'test-file.txt';
const testData = 'Hello, World!';
await fs.promises.writeFile(testFilePath, testData);

const testFilePathWrite = 'test-file-write.txt';
await fs.promises.writeFile(testFilePathWrite, ''); // Ensure the file exists

suite('Streams', config('streams'), () => {
	test('ReadStream reads data correctly', (_, done) => {
		const readStream = fs.createReadStream(testFilePath);

		let data = '';
		readStream.on('data', chunk => {
			data += chunk;
		});
		readStream.on('end', () => {
			assert.equal(data, testData);
			done();
		});
		readStream.on('error', err => {
			done(err);
		});
	});

	test('ReadStream close method works', (_, done) => {
		const readStream = fs.createReadStream(testFilePath);

		let closed = false;
		readStream.on('close', () => {
			closed = true;
		});

		// Closing before the stream has finished reading is a premature close
		readStream.close(err => {
			assert.equal((err as NodeJS.ErrnoException | null)?.code, 'ERR_STREAM_PREMATURE_CLOSE');
			assert(closed);
			done();
		});
	});

	test('WriteStream writes data correctly', async () => {
		const writeStream = fs.createWriteStream(testFilePathWrite);

		const { promise, resolve, reject } = Promise.withResolvers();
		writeStream.on('finish', resolve);
		writeStream.on('error', reject);
		writeStream.end(testData, 'utf8');
		await promise;

		assert.equal(fs.readFileSync(testFilePathWrite, 'utf8'), testData);
	});

	test('WriteStream close method works', (_, done) => {
		const writeStream = fs.createWriteStream(testFilePathWrite);
		let closed = false;
		writeStream.on('close', () => {
			closed = true;
		});
		writeStream.close(err => {
			assert.ifError(err);
			assert(closed);
			done();
		});
	});

	test('createReadStream with start', async () => {
		await fs.promises.writeFile('hello.txt', 'Hello world');

		const stream = fs.createReadStream('hello.txt', { start: 6, encoding: 'utf-8' });

		const data = (await stream.toArray()).join('');

		assert.equal(data, 'world');
	});

	test('createReadStream with end', async () => {
		await fs.promises.writeFile('hello.txt', 'Hello world');

		const stream = fs.createReadStream('hello.txt', { end: 4, encoding: 'utf-8' });

		const data = (await stream.toArray()).join('');

		assert.equal(data, 'Hello');
	});

	test('FileHandle.createReadStream reads data correctly', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		const readStream = fileHandle.createReadStream({ encoding: 'utf-8' });
		const [data] = await readStream.toArray();
		assert.equal(data, testData);
		await fileHandle.close();
	});

	test('FileHandle.createWriteStream writes data correctly', async () => {
		const fileHandle = await fs.promises.open(testFilePathWrite, 'w');
		const writeStream = fileHandle.createWriteStream();

		const { promise, resolve, reject } = Promise.withResolvers();
		writeStream.on('finish', resolve);
		writeStream.on('error', reject);
		writeStream.end(testData, 'utf8');
		await promise;

		const data = await fs.promises.readFile(testFilePathWrite, 'utf8');
		assert.equal(data, testData);
		await fileHandle.close();
	});

	test('readable web stream', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		const webStream = fileHandle.readableWebStream();

		let data = '';

		const decoder = new TextDecoder();

		for await (const chunk of webStream) {
			data += decoder.decode(chunk);
		}

		assert.equal(data, testData);
		await fileHandle.close();
	});

	test('FileHandle.createReadStream after close should give an error', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		await fileHandle.close();
		// Closing invalidates the descriptor, so it fails range validation
		assert.throws(() => fileHandle.createReadStream(), { code: 'ERR_OUT_OF_RANGE' });
	});

	test('FileHandle.createWriteStream after close should give an error', async () => {
		const fileHandle = await fs.promises.open(testFilePathWrite, 'w');
		await fileHandle.close();
		// Closing invalidates the descriptor, so it fails range validation
		assert.throws(() => fileHandle.createWriteStream(), { code: 'ERR_OUT_OF_RANGE' });
	});
});
