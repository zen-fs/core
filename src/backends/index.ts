import { AsyncMirror } from './AsyncMirror.js';
import { FolderAdapter } from './FolderAdapter.js';
import { InMemoryFileSystem as InMemory } from './InMemory.js';
import { OverlayFS } from './OverlayFS.js';
import { BackendConstructor } from './backend.js';

export const backends: { [backend: string]: BackendConstructor } = {};
export default backends;
export { AsyncMirror, FolderAdapter, InMemory, OverlayFS };

export function registerBackend(..._backends: BackendConstructor[]) {
	for (const backend of _backends) {
		backends[backend.Name] = backend;
	}
}

registerBackend(AsyncMirror, FolderAdapter, InMemory, OverlayFS);
