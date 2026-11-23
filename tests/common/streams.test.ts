// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs } from '@zenfs/core';
import { getDefaultHighWaterMark, setDefaultHighWaterMark } from '@zenfs/streams';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

suite('Streams', () => {
	test('createReadStream reads in chunks of the default highWaterMark', async () => {
		fs.writeFileSync('/hwm.bin', new Uint8Array(10_000));
		const previous = getDefaultHighWaterMark(false);
		setDefaultHighWaterMark(false, 4096);
		try {
			const sizes: number[] = [];
			for await (const chunk of fs.createReadStream('/hwm.bin')) sizes.push((chunk as Uint8Array).byteLength);
			assert.deepEqual(sizes, [4096, 4096, 1808]);
		} finally {
			setDefaultHighWaterMark(false, previous);
			fs.unlinkSync('/hwm.bin');
		}
	});

	suite('fs option with short writes', () => {
		type WriteCallback = (error: Error | null, bytesWritten: number, buffers?: Uint8Array[]) => void;

		const open = (_: unknown, flags: string, mode: number, callback: (error: Error | null, fd: number) => void) =>
			fs.open('/short.txt', flags, mode, callback as any);

		function finish(stream: fs.WriteStream, data: string): Promise<void> {
			return new Promise((resolve, reject) => {
				stream.on('error', reject);
				stream.end(data, () => stream.on('close', resolve));
			});
		}

		test('writev resumes after the bytes that were written', async () => {
			fs.writeFileSync('/short.txt', '0123456789');
			const writev = (fd: number, buffers: Uint8Array[], position: number | null, callback: WriteCallback) => {
				const data = Buffer.concat(buffers);
				fs.write(fd, data, 0, Math.min(data.length, 2), position ?? undefined, (error, bytesWritten = 0) =>
					callback(error, bytesWritten, buffers),
				);
			};
			const stream = fs.createWriteStream('/short.txt', { flags: 'r+', start: 2, fs: { open, writev, close: fs.close } as any });
			stream.cork();
			stream.write('abc');
			await finish(stream, 'de');
			assert.equal(fs.readFileSync('/short.txt', 'utf8'), '01abcde789');
		});

		test('fails after repeatedly writing nothing', async () => {
			const write = (...args: unknown[]) => (args.at(-1) as WriteCallback)(null, 0);
			const stream = fs.createWriteStream('/short.txt', { fs: { open, write, close: fs.close } });
			await assert.rejects(finish(stream, 'abc'));
		});
	});
});
