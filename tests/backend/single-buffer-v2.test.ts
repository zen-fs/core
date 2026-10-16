// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs, mount, resolveMountConfig, SingleBuffer, vfs } from '@zenfs/core';
import { SingleBufferStore } from '@zenfs/core/backends/single_buffer/v1';
import { SingleBufferStoreV2, SuperBlock } from '@zenfs/core/backends/single_buffer/v2';
import { Mutex } from 'memium/locks';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { suite, test } from 'node:test';
import { Worker } from 'worker_threads';
import { setupLogs } from '../logs.js';

setupLogs();

function runWorker(workerData: object): Promise<unknown> {
	const worker = new Worker(import.meta.dirname + '/single-buffer-v2.worker.js', { workerData });
	const { promise, resolve, reject } = Promise.withResolvers<unknown>();
	const timeout = setTimeout(() => reject(new Error('worker timed out')), 5000);
	worker.on('error', reject);
	worker.on('message', message => (message instanceof Error ? reject(message) : resolve(message)));
	return promise.finally(() => {
		clearTimeout(timeout);
		void worker.terminate();
		worker.unref();
	});
}

let mounts = 0;

/** Mounts a SingleBuffer on a unique mount point */
async function mountBuffer(buffer: ArrayBufferLike): Promise<[path: string, umount: () => void]> {
	const path = `/sbfs-v2-${mounts++}`;
	mount(path, await resolveMountConfig({ backend: SingleBuffer, buffer, v2: true }));
	return [path, () => vfs.umount(path)];
}

/** Bytes not available for new data */
function used(path: string): number {
	const { blocks, bfree, bsize } = fs.statfsSync(path);
	return (blocks - bfree) * bsize;
}

await suite('SingleBuffer v2', () => {
	test('filesystem restoration from original buffer (with same metadata)', async () => {
		const buffer = new ArrayBuffer(0x100000);

		const [path, umount] = await mountBuffer(buffer);
		fs.writeFileSync(path + '/example.ts', 'console.log("hello world")', 'utf-8');
		const stats = fs.statSync(path + '/example.ts');

		const [snapshot, umountSnapshot] = await mountBuffer(buffer);
		assert.deepEqual(fs.statSync(snapshot + '/example.ts'), stats);

		umount();
		umountSnapshot();
	});

	test('cross-thread SharedArrayBuffer', async () => {
		const buffer = new SharedArrayBuffer(0x100000);
		const [path, umount] = await mountBuffer(buffer);

		assert.equal(await runWorker({ buffer }), 'continue');
		assert(fs.existsSync(path + '/worker-file.ts'));

		umount();
	});

	test('concurrent writers allocate distinct IDs', async () => {
		const buffer = new SharedArrayBuffer(0x1000000);
		const [path, umount] = await mountBuffer(buffer);

		const count = 50,
			workers = 4;
		for (let id = 0; id < workers; id++) fs.mkdirSync(`${path}/w${id}`);

		const results = await Promise.all(Array.from({ length: workers }, (_, id) => runWorker({ buffer, mode: 'write', id, count })));
		assert.deepEqual(results, Array(workers).fill('continue'));

		const [check, umountCheck] = await mountBuffer(buffer);
		const inodes = new Set<number>();
		for (let id = 0; id < workers; id++) {
			for (let i = 0; i < count; i++) {
				const file = `${check}/w${id}/${i}`;
				assert.equal(fs.readFileSync(file, 'utf8'), `worker ${id} file ${i}`);
				inodes.add(fs.statSync(file).ino);
			}
		}
		assert.equal(inodes.size, workers * count);

		umount();
		umountCheck();
	});

	test('readers see whole versions while another thread writes', async () => {
		const buffer = new SharedArrayBuffer(0x1000000);
		const store = new SingleBufferStoreV2(buffer);

		store.set(100, new Uint8Array(1000).fill(1));
		const gate = new Int32Array(new SharedArrayBuffer(4));
		const reader = runWorker({ buffer, gate, mode: 'read' });
		Atomics.wait(gate, 0, 0, 5000);

		for (let i = 0; i < 2000; i++) store.set(100, new Uint8Array(1000 + ((i * 7919) % 50000)).fill(i % 255 || 1));
		store.set(101, new Uint8Array(1));

		assert.ok(((await reader) as number) > 0, 'the reader never read anything');
	});

	test('reuses freed space', async () => {
		const [path, umount] = await mountBuffer(new ArrayBuffer(0x100000));
		const baseline = used(path);

		// Writes far more than the buffer can hold
		for (let i = 0; i < 200; i++) {
			fs.writeFileSync(path + '/churn', randomBytes(0x10000));
			fs.appendFileSync(path + '/log', randomBytes(1024));
			if (i % 10 == 9) fs.rmSync(path + '/log');
		}
		fs.rmSync(path + '/churn');
		fs.writeFileSync(path + '/settle', '');
		fs.rmSync(path + '/settle');

		assert.ok(used(path) - baseline < 0x8000, `leaked ${used(path) - baseline} bytes`);
		umount();
	});

	test('failed writes leave the store unchanged', () => {
		const store = new SingleBufferStoreV2(new ArrayBuffer(0x100000));
		store.set(10, new Uint8Array([1, 2, 3]));
		const before = store.usage();

		assert.throws(() => store.set(12, new Uint8Array(0x200000)), { code: 'ENOSPC' });
		assert.throws(() => store.set(10, new Uint8Array(0x200000)), { code: 'ENOSPC' });

		assert.deepEqual(store.get(10), new Uint8Array([1, 2, 3]));
		assert.equal(store.get(12), undefined);
		assert.deepEqual(store.usage(), before);

		store.set(12, new Uint8Array([4]));
		assert.deepEqual(store.get(12), new Uint8Array([4]));
	});

	test('recovers from a writer that stopped while holding the lock', async () => {
		const buffer = new SharedArrayBuffer(0x100000);
		const [path, umount] = await mountBuffer(buffer);

		const { state_offset } = new SuperBlock(buffer, 0);
		new Mutex(buffer, state_offset, { lease: 50 }).lock();

		fs.writeFileSync(path + '/after', 'recovered');
		assert.equal(fs.readFileSync(path + '/after', 'utf8'), 'recovered');
		umount();
	});

	test('upgrades version 1 file systems in place', async () => {
		const buffer = new ArrayBuffer(0x300000);
		const v1 = '/sbfs-v1';
		mount(v1, await resolveMountConfig({ backend: SingleBuffer, buffer }));

		// Enough files for several metadata blocks, with growth and deletion leaking space
		fs.mkdirSync(v1 + '/dir/nested', { recursive: true });
		const files = new Map<string, string>();
		const deleted: string[] = [];
		for (let i = 0; i < 300; i++) {
			const file = (i % 3 ? '/dir/' : i % 2 ? '/dir/nested/' : '/') + 'f' + i;
			let content = `file ${i}\n`.repeat((i % 7) + 1);
			fs.writeFileSync(v1 + file, content);

			if (i % 10 == 0) {
				content += 'grown\n'.repeat(20);
				fs.writeFileSync(v1 + file, content);
			}

			if (i % 25 == 0) {
				fs.unlinkSync(v1 + file);
				deleted.push(file);
			} else files.set(file, content);
		}

		const stats = new Map(Array.from(files.keys(), file => [file, fs.statSync(v1 + file)]));
		const v1Free = 0x300000 - used(v1);
		vfs.umount(v1);
		assert.equal(new SuperBlock(buffer, 0).version, 1);

		const [path, umount] = await mountBuffer(buffer);
		assert.equal(new SuperBlock(buffer, 0).version, 2);

		for (const [file, content] of files) {
			assert.deepEqual(fs.statSync(path + file), stats.get(file), `stats of ${file}`);
			assert.equal(fs.readFileSync(path + file, 'utf8'), content, `content of ${file}`);
		}
		for (const file of deleted) assert.ok(!fs.existsSync(path + file), `${file} should have been deleted`);

		// Space leaked by version 1 and its metadata blocks are reclaimed
		fs.writeFileSync(path + '/new', 'written after upgrading');
		fs.rmSync(path + '/new');
		const free = 0x300000 - used(path);
		assert.ok(free > v1Free + 0x10000, `only ${free} bytes are free after upgrading, compared to ${v1Free}`);

		const [again, umountAgain] = await mountBuffer(buffer);
		assert.equal(fs.readFileSync(again + '/dir/f1', 'utf8'), files.get('/dir/f1'));

		umount();
		umountAgain();
	});

	test('is opt-in, but always used for existing version 2 file systems', async () => {
		const buffer = new ArrayBuffer(0x100000);

		await resolveMountConfig({ backend: SingleBuffer, buffer });
		assert.equal(new SuperBlock(buffer, 0).version, 1);

		await resolveMountConfig({ backend: SingleBuffer, buffer, v2: true });
		assert.equal(new SuperBlock(buffer, 0).version, 2);

		mount('/sbfs-detect', await resolveMountConfig({ backend: SingleBuffer, buffer }));
		fs.writeFileSync('/sbfs-detect/file', 'still version 2');
		assert.equal(new SuperBlock(buffer, 0).version, 2);
		vfs.umount('/sbfs-detect');

		assert.throws(() => new SingleBufferStore(buffer), { code: 'EIO' });
	});

	test('reliability across varied file sizes', async () => {
		const buffer = new ArrayBuffer(0x400000);
		const [path, umount] = await mountBuffer(buffer);

		const filePath = `${path}/payload.bin`;
		const growthSizes = [0, 1, 17, 512, 8192, 65535, 262144, 524288];
		const shrinkSizes = [262144, 4096, 128, 0];

		const verifySnapshot = async (expected: Buffer, size: number) => {
			const [verify, umountVerify] = await mountBuffer(buffer);
			try {
				const reopened = fs.readFileSync(`${verify}/payload.bin`);
				assert.strictEqual(reopened.byteLength, size, `snapshot size mismatch for ${size} bytes`);
				assert.deepStrictEqual(reopened, expected, `snapshot content mismatch for ${size} bytes`);
			} finally {
				umountVerify();
			}
		};

		try {
			for (const size of [...growthSizes, ...shrinkSizes]) {
				const payload = size ? randomBytes(size) : Buffer.alloc(0);
				fs.writeFileSync(filePath, payload);
				const direct = fs.readFileSync(filePath);
				assert.strictEqual(direct.byteLength, size, `direct size mismatch for ${size} bytes`);
				assert.deepStrictEqual(direct, payload, `direct content mismatch for ${size} bytes`);
				await verifySnapshot(direct, size);
			}
		} finally {
			umount();
		}
	});

	test('files with uneven sizes', async () => {
		const [path, umount] = await mountBuffer(new ArrayBuffer(0x400000));

		const sizes = [1, 17, 257, 3, 5, 13, 1023, 4095, 7, 9];
		try {
			for (let i = 0; i < 400; i++) fs.writeFileSync(`${path}/f${i}.txt`, Buffer.alloc(sizes[i % sizes.length], i & 0xff));
			for (let i = 0; i < 400; i += 37) {
				const expected = Buffer.alloc(sizes[i % sizes.length], i & 0xff);
				assert.deepStrictEqual(fs.readFileSync(`${path}/f${i}.txt`), expected, `content mismatch at f${i}.txt`);
			}
		} finally {
			umount();
		}
	});
});
