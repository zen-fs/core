import { AsyncMirror } from './AsyncMirror.js';
import { InMemoryFileSystem as InMemory } from './InMemory.js';
import { OverlayFS } from './OverlayFS.js';
import { BackendConstructor } from './backend.js';

export const backends: { [backend: string]: BackendConstructor } = {};
export default backends;
export { AsyncMirror, InMemory, OverlayFS };

export function registerBackend(..._backends: BackendConstructor[]) {
	for (const backend of _backends) {
		backends[backend.Name] = backend;
	}
}

registerBackend(AsyncMirror, InMemory, OverlayFS);
