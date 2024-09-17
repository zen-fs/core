import { fs } from '../common.js';

// Top-level initialization
const testFilePath = 'test-file.txt';
const testData = 'Hello, World!';
await fs.promises.writeFile(testFilePath, testData);

const testFilePathWrite = 'test-file-write.txt';
await fs.promises.writeFile(testFilePathWrite, ''); // Ensure the file exists

describe('ReadStream', () => {
	test('ReadStream reads data correctly', done => {
		const readStream = fs.createReadStream(testFilePath);
		let data = '';
		readStream.on('data', chunk => {
			data += chunk;
		});
		readStream.on('end', () => {
			expect(data).toEqual(testData);
			done();
		});
		readStream.on('error', err => {
			done(err);
		});
	});

	test('ReadStream close method works', done => {
		const readStream = fs.createReadStream(testFilePath);
		let closed = false;
		readStream.on('close', () => {
			closed = true;
		});
		readStream.close(err => {
			expect(err).toBeUndefined();
			expect(closed).toBe(true);
			done();
		});
	});

	test('ReadStream declared properties', () => {
		const readStream = new fs.ReadStream();
		expect(readStream.bytesRead).toBeUndefined();
		expect(readStream.path).toBeUndefined();
		expect(readStream.pending).toBeUndefined();

		// Assign values
		readStream.bytesRead = 10;
		readStream.path = testFilePath;
		readStream.pending = false;

		expect(readStream.bytesRead).toBe(10);
		expect(readStream.path).toBe(testFilePath);
		expect(readStream.pending).toBe(false);
	});

	test('ReadStream close method can be called multiple times', done => {
		const readStream = new fs.ReadStream();
		readStream.close(err => {
			expect(err).toBeUndefined();
			// Call close again
			readStream.close(err2 => {
				expect(err2).toBeUndefined();
				done();
			});
		});
	});
});

describe('WriteStream', () => {
	test.skip('WriteStream writes data correctly', done => {
		const writeStream = fs.createWriteStream(testFilePathWrite);
		writeStream.write(testData, 'utf8', err => {
			if (err) {
				done(err);
				return;
			}
			writeStream.end();
		});
		writeStream.on('finish', () => {
			expect(fs.readFileSync(testFilePathWrite, 'utf8')).toEqual(testData);
			done();
		});
		writeStream.on('error', err => {
			done(err);
		});
	});

	test('WriteStream close method works', done => {
		const writeStream = fs.createWriteStream(testFilePathWrite);
		let closed = false;
		writeStream.on('close', () => {
			closed = true;
		});
		writeStream.close(err => {
			expect(err).toBeUndefined();
			expect(closed).toBe(true);
			done();
		});
	});

	test('WriteStream declared properties', () => {
		const writeStream = new fs.WriteStream();
		expect(writeStream.bytesWritten).toBeUndefined();
		expect(writeStream.path).toBeUndefined();
		expect(writeStream.pending).toBeUndefined();

		// Assign values
		writeStream.bytesWritten = 20;
		writeStream.path = testFilePathWrite;
		writeStream.pending = true;

		expect(writeStream.bytesWritten).toBe(20);
		expect(writeStream.path).toBe(testFilePathWrite);
		expect(writeStream.pending).toBe(true);
	});

	test('WriteStream close method can be called multiple times', done => {
		const writeStream = new fs.WriteStream();
		writeStream.close(err => {
			expect(err).toBeUndefined();
			// Call close again
			writeStream.close(err2 => {
				expect(err2).toBeUndefined();
				done();
			});
		});
	});
});

describe('FileHandle', () => {
	test.skip('FileHandle.createReadStream reads data correctly', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		const readStream = fileHandle.createReadStream();
		let data = '';
		await new Promise<void>((resolve, reject) => {
			readStream.on('data', chunk => {
				data += chunk;
			});
			readStream.on('end', () => {
				expect(data).toEqual(testData);
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
		expect(data).toEqual(testData);
		await fileHandle.close();
	});

	test('FileHandle.createReadStream after close should throw', async () => {
		const fileHandle = await fs.promises.open(testFilePath, 'r');
		await fileHandle.close();
		expect(() => {
			fileHandle.createReadStream();
		}).toThrow();
	});

	test.skip('FileHandle.createWriteStream after close should throw', async () => {
		const fileHandle = await fs.promises.open(testFilePathWrite, 'w');
		await fileHandle.close();
		expect(() => {
			fileHandle.createWriteStream();
		}).toThrow();
	});
});
