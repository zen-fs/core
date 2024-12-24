import { suite, test } from 'node:test';
import assert from 'node:assert';
import { bindContext } from '../../dist/context.js';
import * as fs from '../../dist/emulation/index.js';

fs.mkdirSync('/new_root');
const { fs: c_fs } = bindContext('/new_root');

suite('Context', () => {
	test('create a file', () => {
		c_fs.writeFileSync('/example.txt', 'not in real root!');
		assert.deepEqual(fs.readdirSync('/'), ['new_root']);
		assert.deepEqual(fs.readdirSync('/new_root'), ['example.txt']);
	});

	test('break-out fails', () => {
		assert.deepEqual(c_fs.readdirSync('/../../'), ['example.txt']);
	});

	test('watch should consider context', async () => {
		let lastFile: string,
			events = 0;
		const watcher = c_fs.promises.watch('/', { recursive: true });

		(async () => {
			for await (const event of watcher) {
				lastFile = event.filename!;
				if (++events == 2) return;
			}
		})();
		await c_fs.promises.writeFile('/xpto.txt', 'in real root');
		assert.strictEqual(lastFile!, 'xpto.txt');
		await c_fs.promises.unlink('/xpto.txt');
		assert.strictEqual(lastFile, 'xpto.txt');
	});
});
