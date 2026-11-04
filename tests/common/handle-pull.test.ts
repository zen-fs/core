// SPDX-License-Identifier: LGPL-3.0-or-later
import { promises } from '@zenfs/core';
import assert from 'node:assert/strict';
import type { FileHandle } from 'node:fs/promises';
import { suite, test } from 'node:test';

const content = 'hello';

/** Decode a `ByteReadableStream` (`AsyncIterable<Uint8Array[]>`) into a string. */
async function text(source: AsyncIterable<Uint8Array[]>): Promise<string> {
	const decoder = new TextDecoder();
	let out = '';
	for await (const chunks of source) {
		for (const chunk of chunks) out += decoder.decode(chunk, { stream: true });
	}
	return out + decoder.decode();
}

// The `asciiUpper` transform from the Node.js `node:stream/iter` docs.
const asciiUpper = (chunks: Uint8Array[] | null): Uint8Array[] | null => {
	if (chunks === null) return null;
	return chunks.map(c => {
		for (let i = 0; i < c.length; i++) {
			c[i] -= (c[i] >= 97 && c[i] <= 122 ? 1 : 0) * 32;
		}
		return c;
	});
};

const handle: FileHandle = await promises.open('./pull.txt', 'w+');
await handle.writeFile(content);

suite('FileHandle.pull', () => {
	test('reads file contents', async () => {
		assert.equal(await text(handle.pull({ start: 0 })), content);
	});

	test('reads a range with start and limit', async () => {
		assert.equal(await text(handle.pull({ start: 1, limit: 3 })), content.slice(1, 4));
	});

	test('respects a small chunkSize', async () => {
		const chunks: number[] = [];
		for await (const part of handle.pull({ start: 0, chunkSize: 2 })) {
			for (const c of part) chunks.push(c.length);
		}
		assert.deepEqual(chunks, [2, 2, 1]);
	});

	test('applies the asciiUpper transform from the Node.js docs', async () => {
		assert.equal(await text(handle.pull(asciiUpper, { start: 0 })), content.toUpperCase()); // 'HELLO'
	});

	test('autoClose closes the handle', async () => {
		const fh = await promises.open('./pull-autoclose.txt', 'w+');
		await fh.writeFile(content);
		assert.equal(await text(fh.pull({ start: 0, autoClose: true })), content);
		await assert.rejects(fh.readFile('utf8'));
	});
});

suite('FileHandle.pullSync', () => {
	const textSync = (source: Iterable<Uint8Array[]>): string => Buffer.concat([...source].flat()).toString();

	test('reads from the current position by default', async () => {
		await using fh = await promises.open('./pull.txt');
		await fh.read(Buffer.alloc(2));
		assert.equal(textSync(fh.pullSync()), content.slice(2));
		assert.equal((await fh.read(Buffer.alloc(1))).bytesRead, 0);
	});

	test('reads a range with start, limit, and chunkSize', () => {
		const chunks = [...handle.pullSync({ start: 1, limit: 3, chunkSize: 2 })].map(part => textSync([part]));
		assert.deepEqual(chunks, ['el', 'l']);
	});

	test('applies stateless and stateful transforms', () => {
		assert.equal(textSync(handle.pullSync(asciiUpper, { start: 0 })), content.toUpperCase());

		const counter = {
			*transform(source: Iterable<Uint8Array[] | null>) {
				let length = 0;
				for (const chunks of source) {
					if (chunks === null) yield `|${length}`;
					else for (const chunk of chunks) yield ((length += chunk.length), chunk);
				}
			},
		};
		assert.equal(textSync(handle.pullSync(counter, { start: 0 })), content + '|' + content.length);
	});

	test('autoClose closes the handle when iteration ends', async () => {
		const fh = await promises.open('./pull.txt');
		const iterator = fh.pullSync({ start: 0, chunkSize: 1, autoClose: true })[Symbol.iterator]();
		iterator.next();
		iterator.return?.();
		assert.equal(fh.fd, -1);
	});
});

suite('FileHandle.writer', { timeout: 1000 }, () => {
	test('writes data backed by the handle', async () => {
		const fh = await promises.open('./writer.txt', 'w+');
		const w = fh.writer();
		await w.write('Hello!');
		assert.equal(await w.end(), 6);
		assert.equal(await promises.readFile('./writer.txt', 'utf8'), 'Hello!');
		await fh.close();
	});

	test('concurrent writes are applied in call order', async () => {
		const fh = await promises.open('./writer-concurrent.txt', 'w+');
		const w = fh.writer();
		await Promise.all([w.write('aaa'), w.writev(['bbb', 'ccc']), w.write('ddd')]);
		assert.equal(await w.end(), 12);
		assert.equal(await promises.readFile('./writer-concurrent.txt', 'utf8'), 'aaabbbcccddd');
		await fh.close();
	});

	test('queued writes are not started after the writer fails', async () => {
		const fh = await promises.open('./writer-failed.txt', 'w+');
		const w = fh.writer();
		const first = w.write('aaa');
		const second = w.write('bbb');
		w.fail(new Error('failed'));
		await assert.rejects(first);
		await assert.rejects(second);
		assert.equal(await promises.readFile('./writer-failed.txt', 'utf8'), '');
		await fh.close();
	});

	test('limit rejects oversized writes', async () => {
		const fh = await promises.open('./writer-limit.txt', 'w+');
		const w = fh.writer({ limit: 4 });
		await assert.rejects(w.write('too long'), RangeError);
		await fh.close();
	});

	test('autoClose closes the handle on end', async () => {
		const fh = await promises.open('./writer-autoclose.txt', 'w+');
		using w = fh.writer({ autoClose: true });
		await w.write('bye');
		await w.end();
		await assert.rejects(fh.readFile('utf8'));
	});
});
