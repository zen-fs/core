import { AsyncMirror } from './AsyncMirror';
import { FolderAdapter } from './FolderAdapter';
import { InMemoryFileSystem as InMemory } from './InMemory';
import { OverlayFS } from './OverlayFS';
import { BackendConstructor } from './backend';

export const backends: { [backend: string]: BackendConstructor } = {
	AsyncMirror,
	FolderAdapter,
	InMemory,
	OverlayFS,
};
export default backends;

export function registerBackend(name: string, fs: BackendConstructor) {
	backends[name] = fs;
}
