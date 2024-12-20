import assert from 'node:assert';
import { suite, test } from 'node:test';
import { configure } from '../../dist/config.js';
import * as fs from '../../dist/emulation/index.js';
import { InMemoryStore, StoreFS } from '../../dist/index.js';
import { Async } from '../../dist/mixins/async.js';

class ExampleAsyncFS extends Async(StoreFS) {
	_sync = new StoreFS(new InMemoryStore('cache'));

	public constructor() {
		super(new InMemoryStore('test'));
	}
}

const asyncFS = new ExampleAsyncFS();

await configure({ mounts: { '/': asyncFS } });

suite('Async Mixin', () => {
	test('async -> cache syncing', async () => {
		await fs.promises.writeFile('test', 'test');
		assert.strictEqual(fs.readFileSync('test', 'utf8'), 'test');
	});

	test('cache -> async syncing', async () => {
		fs.unlinkSync('test');
		await asyncFS.queueDone();
		assert(!(await fs.promises.exists('test')));
	});
});
