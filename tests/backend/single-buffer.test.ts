// SPDX-License-Identifier: LGPL-3.0-or-later
import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { suite, test } from 'node:test';
import { Worker } from 'worker_threads';
import { sizeof } from 'memium';
import { fs, mount, resolveMountConfig, SingleBuffer, vfs } from '@zenfs/core';
import { MetadataBlock, SuperBlock } from '@zenfs/core/backends/single_buffer';
import { setupLogs } from '../logs.js';

setupLogs();

await suite('SingleBuffer', () => {
	test('filesystem restoration from original buffer (with same metadata)', async () => {
		const buffer = new ArrayBuffer(0x100000);

		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/mnt', writable);

		fs.writeFileSync('/mnt/example.ts', 'console.log("hello world")', 'utf-8');
		const stats = fs.statSync('/mnt/example.ts');

		const snapshot = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/snapshot', snapshot);

		const snapshotStats = fs.statSync('/snapshot/example.ts');

		assert.deepEqual(snapshotStats, stats);
	});

	test('cross-thread SharedArrayBuffer', async () => {
		const sharedBuffer = new SharedArrayBuffer(0x100000);

		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer: sharedBuffer });
		fs.mkdirSync('/shared');
		mount('/shared', writable);

		const worker = new Worker(import.meta.dirname + '/single-buffer.worker.js', { workerData: sharedBuffer });

		// Pause while we wait for the worker to emit the 'continue' message, which
		// means it has mounted the filesystem and created /worker-file.ts
		const { promise, resolve, reject } = Promise.withResolvers<void>();

		setTimeout(reject, 1000);
		worker.on('message', message => {
			if (message === 'continue') resolve();
			else reject(message ?? new Error('Failed'));
		});

		await promise;

		await worker.terminate();
		worker.unref();

		assert(fs.existsSync('/shared/worker-file.ts'));
	});

	test('aligns metadata when used_bytes is unaligned #309', () => {
		// Writers reserve data of any length, so used_bytes can sit at any remainder when the metadata block is rotated.
		for (const used of [8192n, 8193n, 8194n, 8195n]) {
			const superblock = new SuperBlock(new ArrayBuffer(0x100000));
			superblock.used_bytes = used;

			const metadata = superblock.rotateMetadata();
			const expected = Number((used + 3n) & ~3n);

			assert.strictEqual(metadata.byteOffset, expected, `metadata offset for used_bytes ${used}`);
			assert.strictEqual(superblock.used_bytes, BigInt(expected + sizeof(MetadataBlock)), `used_bytes after rotating from ${used}`);
		}
	});

	test('refuses to rotate metadata past the end of the filesystem', () => {
		const exhausted = new SuperBlock(new ArrayBuffer(sizeof(SuperBlock) + sizeof(MetadataBlock) + 4));
		const exhaustedUsed = exhausted.used_bytes;

		assert.throws(() => exhausted.rotateMetadata(), { code: 'ENOSPC' }, 'rotating without room should fail with ENOSPC');
		assert.strictEqual(exhausted.used_bytes, exhaustedUsed, 'a failed rotation must not consume space');

		const constrained = new SuperBlock(new ArrayBuffer(0x100000));
		constrained.total_bytes = BigInt(sizeof(SuperBlock) + sizeof(MetadataBlock) + 4);
		const constrainedUsed = constrained.used_bytes;

		assert.throws(() => constrained.rotateMetadata(), { code: 'ENOSPC' }, 'rotating past total_bytes should fail with ENOSPC');
		assert.strictEqual(constrained.used_bytes, constrainedUsed, 'a failed rotation must not consume space');
		assert(constrained.used_bytes <= constrained.total_bytes, 'used_bytes must never exceed total_bytes');
	});

	test('concurrent rotation keeps every metadata block reachable', async () => {
		const rotations = 100;
		const buffer = new SharedArrayBuffer(0x200000);
		const gate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

		const superblock = new SuperBlock(buffer);
		const original = superblock.metadata_offset;

		const worker = new Worker(import.meta.dirname + '/single-buffer-rotate.worker.js', { workerData: { buffer, gate, rotations } });

		const ready = Promise.withResolvers<void>();
		const finished = Promise.withResolvers<number[]>();
		const expired = setTimeout(() => {
			const error = new Error('the worker did not finish rotating');
			ready.reject(error);
			finished.reject(error);
		}, 1000);

		worker.on('error', error => {
			ready.reject(error);
			finished.reject(error);
		});
		worker.on('message', message => (message === 'ready' ? ready.resolve() : finished.resolve(message as number[])));

		try {
			await ready.promise;

			Atomics.store(gate, 0, 1);
			Atomics.notify(gate, 0);

			const mine: number[] = [];
			for (let i = 0; i < rotations; i++) mine.push(superblock.rotateMetadata().byteOffset);

			const theirs = await finished.promise;

			const chain = new Set<number>();
			for (let block: MetadataBlock | undefined = new SuperBlock(buffer).metadata; block; block = block.previous) {
				if (chain.has(block.byteOffset)) break;
				chain.add(block.byteOffset);
			}

			assert.strictEqual(new Set([...mine, ...theirs]).size, rotations * 2, 'two rotations reserved the same offset');
			assert.strictEqual(chain.size, rotations * 2 + 1, 'blocks are missing from the chain');

			for (const offset of [original, ...mine, ...theirs]) assert(chain.has(offset), `the block at ${offset} is not in the chain`);
		} finally {
			clearTimeout(expired);
			await worker.terminate();
			worker.unref();
		}
	});

	test('reliability across varied file sizes', async () => {
		const mountPoint = '/sbfs-reliability';
		const verifyMountPoint = '/sbfs-verify';
		const buffer = new ArrayBuffer(0x400000);
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer, label: 'reliability' });
		mount(mountPoint, writable);

		const filePath = `${mountPoint}/payload.bin`;
		const growthSizes = [0, 1, 17, 512, 8192, 65535, 262144, 524288];
		const shrinkSizes = [262144, 4096, 128, 0];

		const verifySnapshot = (expected: Buffer, size: number) => {
			mount(verifyMountPoint, writable);
			try {
				const reopened = fs.readFileSync(`${verifyMountPoint}/payload.bin`);
				assert.strictEqual(reopened.byteLength, size, `snapshot size mismatch for ${size} bytes`);
				assert.deepStrictEqual(reopened, expected, `snapshot content mismatch for ${size} bytes`);
			} finally {
				vfs.umount(verifyMountPoint);
			}
		};

		try {
			for (const size of growthSizes) {
				const payload = size ? randomBytes(size) : Buffer.alloc(0);
				fs.writeFileSync(filePath, payload);
				const direct = fs.readFileSync(filePath);
				assert.strictEqual(direct.byteLength, size, `direct size mismatch for ${size} bytes`);
				assert.deepStrictEqual(direct, payload, `direct content mismatch for ${size} bytes`);
				verifySnapshot(direct, size);
			}

			for (const size of shrinkSizes) {
				const payload = size ? randomBytes(size) : Buffer.alloc(0);
				fs.writeFileSync(filePath, payload);
				const direct = fs.readFileSync(filePath);
				assert.strictEqual(direct.byteLength, size, `direct size mismatch after shrink to ${size} bytes`);
				assert.deepStrictEqual(direct, payload, `direct content mismatch after shrink to ${size} bytes`);
				verifySnapshot(direct, size);
			}
		} finally {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
			vfs.umount(mountPoint);
		}
	});

	test('keeps metadata aligned when files have uneven sizes #309', async () => {
		const mountPoint = '/sbfs-rotation';
		const buffer = new ArrayBuffer(0x400000);
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer, label: 'rotation' });
		mount(mountPoint, writable);

		// Uneven writes leave used_bytes between alignment boundaries when the metadata block fills up.
		const sizes = [1, 17, 257, 3, 5, 13, 1023, 4095, 7, 9];
		try {
			for (let i = 0; i < 400; i++) {
				const content = Buffer.alloc(sizes[i % sizes.length], i & 0xff);
				fs.writeFileSync(`${mountPoint}/f${i}.txt`, content);
			}
			for (let i = 0; i < 400; i += 37) {
				const expected = Buffer.alloc(sizes[i % sizes.length], i & 0xff);
				assert.deepStrictEqual(fs.readFileSync(`${mountPoint}/f${i}.txt`), expected, `content mismatch at f${i}.txt`);
			}
		} finally {
			vfs.umount(mountPoint);
		}
	});
});
