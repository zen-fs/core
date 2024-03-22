import { AsyncMirror } from './AsyncMirror.js';
import { InMemory } from './InMemory.js';
import { Overlay } from './Overlay.js';
import { backends, registerBackend } from './backend.js';

export { AsyncMirror, InMemory, Overlay };
export default backends;

registerBackend(AsyncMirror, InMemory, Overlay);
