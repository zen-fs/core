import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { fs } from '../common.js';
import { promisify } from 'node:util';

// Top-level initialization
const testFilePath = 'test-file.txt';
const testData = 'Hello, World!';
await fs.promises.writeFile(testFilePath, testData);

const testFilePathWrite = 'test-file-write.txt';
await fs.promises.writeFile(testFilePathWrite, ''); // Ensure the file exists

suite('Streams', () => {
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

		readStream.close(err => {
			assert.ifError(err);
			assert(closed);
			done();
		});
	});

	test('ReadStream declared properties', () => {
		const readStream = new fs.ReadStream();
		assert.equal(readStream.bytesRead, undefined);
		assert.equal(readStream.path, undefined);
		assert.equal(readStream.pending, undefined);

		// Assign values
		readStream.bytesRead = 10;
		readStream.path = testFilePath;
		readStream.pending = false;

		assert.equal(readStream.bytesRead, 10);
		assert.equal(readStream.path, testFilePath);
		assert(!readStream.pending);
	});

	test('ReadStream close method can be called multiple times', async () => {
		const readStream = new fs.ReadStream();

		const close = promisify(readStream.close);
		await close();
		await close();
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

	test('WriteStream declared properties', () => {
		const writeStream = new fs.WriteStream();
		assert.equal(writeStream.bytesWritten, undefined);
		assert.equal(writeStream.path, undefined);
		assert.equal(writeStream.pending, undefined);

		// Assign values
		writeStream.bytesWritten = 20;
		writeStream.path = testFilePathWrite;
		writeStream.pending = true;

		assert.equal(writeStream.bytesWritten, 20);
		assert.equal(writeStream.path, testFilePathWrite);
		assert(writeStream.pending);
	});

	test('WriteStream close method can be called multiple times', async () => {
		const writeStream = new fs.WriteStream();

		const close = promisify(writeStream.close);
		await close();
		await close();
	});

	test('createReadStream with start', async () => {
		await fs.promises.writeFile('hello.txt', 'Hello world');

		const stream = fs.createReadStream('hello.txt', { start: 6, encoding: 'utf-8' });

		const data = (await stream.toArray()).join('');

		assert.equal(data, 'world');
	});

	test('createReadStream with end', async () => {
		await fs.promises.writeFile('hello.txt', 'Hello world');

		const stream = fs.createReadStream('hello.txt', { end: 5, encoding: 'utf-8' });

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

	test('FileHandle.createReadStream after close should give an error', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		await fileHandle.close();
		const stream = fileHandle.createReadStream();
		const { promise, resolve, reject } = Promise.withResolvers();
		setTimeout(resolve, 100);
		stream.on('error', reject);
		assert.rejects(promise);
	});

	test('FileHandle.createWriteStream after close should give an error', async () => {
		const fileHandle = await fs.promises.open(testFilePathWrite, 'w');
		await fileHandle.close();
		const stream = fileHandle.createWriteStream();
		const { promise, resolve, reject } = Promise.withResolvers();
		setTimeout(resolve, 100);
		stream.on('error', reject);
		assert.rejects(promise);
		stream.write('Nuh-uh');
	});
});
