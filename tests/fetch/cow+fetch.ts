import { configureSingle, Fetch, InMemory, Overlay, resolveMountConfig } from '../../dist/index.js';

const baseUrl = 'http://localhost:26514';

await configureSingle({
	backend: Overlay,
	readable: await resolveMountConfig({
		backend: Fetch,
		baseUrl,
		index: baseUrl + '/.index.json',
	}),
	writable: InMemory.create({ name: 'cow' }),
});
