import { configureSingle, InMemory, Overlay } from '../../dist/index.js';

await configureSingle({
	backend: Overlay,
	readable: InMemory.create({ name: 'ro' }),
	writable: InMemory.create({ name: 'cow' }),
});
