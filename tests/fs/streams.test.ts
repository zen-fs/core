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

	// A file large enough to span several chunks, so the read path has to stitch
	// them back together and the vnode cache has to grow to hold them.
	const large = Buffer.alloc(200 * 1024);
	for (let i = 0; i < large.length; i++) large[i] = (i * 31 + 7) & 0xff;

	test('createReadStream reads a multi-chunk file byte for byte', async () => {
		await fs.promises.writeFile('large.bin', large);

		const chunks: Uint8Array[] = [];
		for await (const chunk of fs.createReadStream('large.bin')) chunks.push(chunk as Uint8Array);

		assert.deepEqual(Buffer.concat(chunks), large);
	});

	test('createReadStream honors highWaterMark as the chunk size', async () => {
		await fs.promises.writeFile('large.bin', large);

		const highWaterMark = 64 * 1024;
		const sizes: number[] = [];
		for await (const chunk of fs.createReadStream('large.bin', { highWaterMark })) sizes.push((chunk as Uint8Array).byteLength);

		// Every chunk but the last is a full highWaterMark, and they sum to the file
		assert.deepEqual(sizes.slice(0, -1), Array(sizes.length - 1).fill(highWaterMark));
		assert.equal(
			sizes.reduce((a, b) => a + b, 0),
			large.length
		);
	});

	test('createReadStream with start and end spanning chunks', async () => {
		await fs.promises.writeFile('large.bin', large);

		// `end` is inclusive, and this range deliberately starts and stops mid-chunk
		const start = 1000;
		const end = 150_000;
		const chunks: Uint8Array[] = [];
		for await (const chunk of fs.createReadStream('large.bin', { start, end, highWaterMark: 8192 })) chunks.push(chunk as Uint8Array);

		assert.deepEqual(Buffer.concat(chunks), large.subarray(start, end + 1));
	});

	test('a read stream does not read past the end of the file', async () => {
		await fs.promises.writeFile('small.bin', large.subarray(0, 10));

		const chunks: Uint8Array[] = [];
		for await (const chunk of fs.createReadStream('small.bin', { highWaterMark: 64 * 1024 })) chunks.push(chunk as Uint8Array);

		assert.equal(chunks.length, 1);
		assert.deepEqual(chunks[0], large.subarray(0, 10));
	});

	test('a read stream over an empty file ends without a chunk', async () => {
		await fs.promises.writeFile('empty.bin', '');

		const chunks: unknown[] = [];
		for await (const chunk of fs.createReadStream('empty.bin')) chunks.push(chunk);

		assert.deepEqual(chunks, []);
	});
});
