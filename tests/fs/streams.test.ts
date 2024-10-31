import assert from 'node:assert';
import { suite, test } from 'node:test';
import { fs } from '../common.js';

// Top-level initialization
const testFilePath = 'test-file.txt';
const testData = 'Hello, World!';
await fs.promises.writeFile(testFilePath, testData);

const testFilePathWrite = 'test-file-write.txt';
await fs.promises.writeFile(testFilePathWrite, ''); // Ensure the file exists

suite('ReadStream', () => {
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
			assert.strictEqual(err, undefined);
			assert(closed);
			done();
		});
	});

	test('ReadStream declared properties', () => {
		const readStream = new fs.ReadStream();
		assert.strictEqual(readStream.bytesRead, undefined);
		assert.strictEqual(readStream.path, undefined);
		assert.strictEqual(readStream.pending, undefined);

		// Assign values
		readStream.bytesRead = 10;
		readStream.path = testFilePath;
		readStream.pending = false;

		assert.strictEqual(readStream.bytesRead, 10);
		assert.strictEqual(readStream.path, testFilePath);
		assert(!readStream.pending);
	});

	test('ReadStream close method can be called multiple times', (_, done) => {
		const readStream = new fs.ReadStream();
		readStream.close(err => {
			assert.strictEqual(err, undefined);
			// Call close again
			readStream.close(err2 => {
				assert.strictEqual(err2, undefined);
				done();
			});
		});
	});
});

suite('WriteStream', () => {
	test.skip('WriteStream writes data correctly', (_, done) => {
		const writeStream = fs.createWriteStream(testFilePathWrite);
		writeStream.write(testData, 'utf8', err => {
			if (err) {
				done(err);
				return;
			}
			writeStream.end();
		});
		writeStream.on('finish', () => {
			assert(fs.readFileSync(testFilePathWrite, 'utf8') == testData);
			done();
		});
		writeStream.on('error', err => {
			done(err);
		});
	});

	test('WriteStream close method works', (_, done) => {
		const writeStream = fs.createWriteStream(testFilePathWrite);
		let closed = false;
		writeStream.on('close', () => {
			closed = true;
		});
		writeStream.close(err => {
			assert.strictEqual(err, undefined);
			assert(closed);
			done();
		});
	});

	test('WriteStream declared properties', () => {
		const writeStream = new fs.WriteStream();
		assert.strictEqual(writeStream.bytesWritten, undefined);
		assert.strictEqual(writeStream.path, undefined);
		assert.strictEqual(writeStream.pending, undefined);

		// Assign values
		writeStream.bytesWritten = 20;
		writeStream.path = testFilePathWrite;
		writeStream.pending = true;

		assert.strictEqual(writeStream.bytesWritten, 20);
		assert.strictEqual(writeStream.path, testFilePathWrite);
		assert(writeStream.pending);
	});

	test('WriteStream close method can be called multiple times', (_, done) => {
		const writeStream = new fs.WriteStream();
		writeStream.close(err => {
			assert.strictEqual(err, undefined);
			// Call close again
			writeStream.close(err2 => {
				assert.strictEqual(err2, undefined);
				done();
			});
		});
	});
});

suite('FileHandle', () => {
	test.skip('FileHandle.createReadStream reads data correctly', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		const readStream = fileHandle.createReadStream();
		let data = '';
		await new Promise<void>((resolve, reject) => {
			readStream.on('data', chunk => {
				data += chunk;
			});
			readStream.on('end', () => {
				assert.equal(data, testData);
				resolve();
			});
			readStream.on('error', reject);
		});
		await fileHandle.close();
	});

	test.skip('FileHandle.createWriteStream writes data correctly', async () => {
		const fileHandle = await fs.promises.open(testFilePathWrite, 'w');
		const writeStream = fileHandle.createWriteStream();
		await new Promise<void>((resolve, reject) => {
			writeStream.write(testData, 'utf8', err => {
				if (err) return reject(err);
				writeStream.end();
			});
			writeStream.on('finish', resolve);
			writeStream.on('error', reject);
		});
		const data = await fs.promises.readFile(testFilePathWrite, 'utf8');
		assert.equal(data, testData);
		await fileHandle.close();
	});

	test('FileHandle.createReadStream after close should throw', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		await fileHandle.close();
		assert.throws(() => fileHandle.createReadStream());
	});

	test.skip('FileHandle.createWriteStream after close should throw', async () => {
		const fileHandle = await fs.promises.open(testFilePathWrite, 'w');
		await fileHandle.close();
		assert.throws(() => fileHandle.createWriteStream());
	});
});
