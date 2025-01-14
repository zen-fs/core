import { readFileSync } from 'node:fs';
import { join } from 'node:path/posix';
import { configureSingle, InMemory, InMemoryStore, mounts, Overlay, Readonly, resolveMountConfig, StoreFS } from '../../dist/index.js';
import { S_IFDIR } from '../../dist/vfs/constants.js';
import { copy, data } from '../setup.js';

copy(data);

const index = (mounts.get('/') as StoreFS).createIndexSync();

class MockFS extends Readonly(StoreFS) {
	constructor() {
		super(new InMemoryStore());
		this.loadIndexSync(index);

		using tx = this.store.transaction();

		for (const [path, node] of index) {
			if (node.mode & S_IFDIR) continue;

			const content = readFileSync(join(data, path));

			tx.setSync(node.data, content);
		}

		tx.commitSync();
	}
}

const readable = new MockFS();

await readable.ready();

await configureSingle({
	backend: Overlay,
	readable,
	writable: await resolveMountConfig({ backend: InMemory, name: 'cow' }),
});
