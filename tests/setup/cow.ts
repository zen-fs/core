import { configureSingle, InMemory, CopyOnWrite } from '../../dist/index.js';

await configureSingle({
	backend: CopyOnWrite,
	readable: InMemory.create({ name: 'ro' }),
	writable: InMemory.create({ name: 'cow' }),
});
