import { AsyncMirror } from './AsyncMirror.js';
import { InMemory } from './InMemory.js';
import { Overlay } from './Overlay.js';
import { Backend } from './backend.js';

export const backends: { [backend: string]: Backend } = {};
export default backends;
export { AsyncMirror, InMemory, Overlay };

export function registerBackend(..._backends: Backend[]) {
	for (const backend of _backends) {
		backends[backend.name] = backend;
	}
}

registerBackend(AsyncMirror, InMemory, Overlay);
