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
		assert.equal(await text(handle.pull()), content);
	});

	test('reads a range with start and limit', async () => {
		assert.equal(await text(handle.pull({ start: 1, limit: 3 })), content.slice(1, 4));
	});

	test('respects a small chunkSize', async () => {
		const chunks: number[] = [];
		for await (const part of handle.pull({ chunkSize: 2 })) {
			for (const c of part) chunks.push(c.length);
		}
		assert.deepEqual(chunks, [2, 2, 1]);
	});

	test('applies the asciiUpper transform from the Node.js docs', async () => {
		assert.equal(await text(handle.pull(asciiUpper)), content.toUpperCase()); // 'HELLO'
	});

	test('autoClose closes the handle', async () => {
		const fh = await promises.open('./pull-autoclose.txt', 'w+');
		await fh.writeFile(content);
		assert.equal(await text(fh.pull({ autoClose: true })), content);
		await assert.rejects(fh.readFile('utf8'));
	});
});

suite('FileHandle.writer', () => {
	test('writes data backed by the handle', async () => {
		const fh = await promises.open('./writer.txt', 'w+');
		const w = fh.writer();
		await w.write('Hello!');
		assert.equal(await w.end(), 6);
		assert.equal(await fh.readFile('utf8'), 'Hello!');
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
