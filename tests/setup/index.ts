import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path/posix';
import type { Stats } from '../../dist/index.js';
import { configureSingle, InMemory, InMemoryStore, mounts, Overlay, Readonly, StoreFS } from '../../dist/index.js';
import { S_IFREG } from '../../dist/vfs/constants.js';
import { copy, data } from '../setup.js';

copy(data);

const index = (mounts.get('/') as StoreFS).createIndexSync();

writeFileSync('tmp/_index.json', JSON.stringify(index.toJSON()));

class MockFS extends Readonly(StoreFS) {
	constructor() {
		super(new InMemoryStore());
		this.loadIndexSync(index);

		using tx = this.store.transaction();

		for (const [path, node] of index) {
			if (!(node.mode & S_IFREG)) continue;

			const content = readFileSync(join(data, path));

			tx.setSync(node.data, content);
		}
	}

	// Even read-only, when reading files try to sync stats

	sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		return Promise.resolve();
	}

	syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		return;
	}
}

await configureSingle({
	backend: Overlay,
	readable: new MockFS(),
	writable: InMemory.create({ name: 'cow' }),
});
