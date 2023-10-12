import { AsyncMirror } from './AsyncMirror';
import { FolderAdapter } from './FolderAdapter';
import { InMemoryFileSystem as InMemory } from './InMemory';
import { OverlayFS } from './OverlayFS';
import { BackendConstructor } from './backend';

export const backends: { [backend: string]: BackendConstructor } = {};
export default backends;
export { AsyncMirror, FolderAdapter, InMemory, OverlayFS };

export function registerBackend(..._backends: BackendConstructor[]) {
	for (const backend of _backends) {
		backends[backend.Name] = backend;
	}
}

registerBackend(AsyncMirror, FolderAdapter, InMemory, OverlayFS);
