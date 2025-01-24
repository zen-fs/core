import { configureSingle, Fetch, InMemory, Overlay, resolveMountConfig } from '../../dist/index.js';
import { baseUrl } from './config.js';

await configureSingle({
	backend: Overlay,
	readable: await resolveMountConfig({
		backend: Fetch,
		baseUrl,
		index: baseUrl + '/.index.json',
	}),
	writable: InMemory.create({ name: 'cow' }),
});
