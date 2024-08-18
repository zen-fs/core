# Port Backend

A backend for usage with ports and workers. See the examples below.

#### Accessing an FS on a remote Worker from the main thread

Main:

```ts
import { configure } from '@zenfs/core';
import { Port } from '@zenfs/port';
import { Worker } from 'node:worker_threads';

const worker = new Worker('worker.js');

await configure({
	mounts: {
		'/worker': {
			backend: Port,
			port: worker,
		},
	},
});
```

Worker:

```ts
import { InMemory, resolveRemoteMount, attachFS } from '@zenfs/core';
import { parentPort } from 'node:worker_threads';

await resolveRemoteMount(parentPort, { backend: InMemory, name: 'tmp' });
```

If you are using using web workers, you would use `self` instead of importing `parentPort` in the worker, and would not need to import `Worker` in the main thread.

#### Using with multiple ports on the same thread

```ts
import { InMemory, fs, resolveMountConfig, resolveRemoteMount, Port } from '@zenfs/core';
import { MessageChannel } from 'node:worker_threads';

const { port1: localPort, port2: remotePort } = new MessageChannel();

fs.mount('/remote', await resolveRemoteMount(remotePort, { backend: InMemory, name: 'tmp' }));
fs.mount('/port', await resolveMountConfig({ backend: Port, port: localPort }));

const content = 'FS is in a port';

await fs.promises.writeFile('/port/test', content);

fs.readFileSync('/remote/test', 'utf8'); // FS is in a port
await fs.promises.readFile('/port/test', 'utf8'); // FS is in a port
```
