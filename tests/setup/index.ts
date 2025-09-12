import { readFileSync } from 'node:fs';
import { join } from 'node:path/posix';
import { configureSingle, CopyOnWrite, InMemory, InMemoryStore, mounts, Readonly, StoreFS } from '@zenfs/core';
import { S_IFDIR } from '@zenfs/core/constants';
import { copySync, data } from '../setup.js';

copySync(data);

const index = (mounts.get('/') as StoreFS).createIndexSync();

class MockFS extends Readonly(StoreFS) {
	constructor() {
		super(new InMemoryStore());
		this.loadIndexSync(index);

		using tx = this.transaction();

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
	backend: CopyOnWrite,
	readable,
	writable: { backend: InMemory, label: 'cow' },
});
