import test, { suite } from 'node:test';
import { fs as _fs, mount, resolveMountConfig, SingleBuffer, umount } from '../../dist/index.js';
import assert from 'node:assert';

await suite('SingleBuffer`', () => {
	test('should be able to restore filesystem (with same metadata) from original buffer', async () => {
		const buffer = new ArrayBuffer(0x100000);

		umount('/');
		const writable = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/', writable);

		_fs.writeFileSync('/example.ts', 'console.log("hello world")', 'utf-8');
		const stats = _fs.statSync('/example.ts');

		umount('/');
		const snapshot = await resolveMountConfig({ backend: SingleBuffer, buffer });
		mount('/', snapshot);

		const snapshotStats = _fs.statSync('/example.ts');

		assert.deepEqual(snapshotStats, stats);
	});
});
