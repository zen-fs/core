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
	'/worker': {
		backend: Port,
		port: worker,
	},
});
```

Worker:

```ts
import { InMemory, resolveMountConfig } from '@zenfs/core';
import { attachFS } from '@zenfs/port';
import { parentPort } from 'node:worker_threads';

const tmpfs = await resolveMountConfig({ backend: InMemory, name: 'tmp' });
attachFS(parentPort, tmpfs);
```

If you are using using web workers, you would use `self` instead of importing `parentPort` in the worker, and would not need to import `Worker` in the main thread.

#### Using with multiple ports on the same thread

```ts
import { InMemory, fs, resolveMountConfig } from '@zenfs/core';
import { Port, attachFS } from '@zenfs/port';
import { MessageChannel } from 'node:worker_threads';

const { port1, port2 } = new MessageChannel();

const tmpfs = await resolveMountConfig({ backend: InMemory, name: 'tmp' });
attachFS(port2, tmpfs);
fs.mount('/port', await resolveMountConfig({ backend: Port, port: port1 }));
console.log('/port');

const content = 'FS is in a port';

await fs.promises.writeFile('/port/test', content);

fs.readFileSync('/tmp/test', 'utf8'); // FS is in a port
await fs.promises.readFile('/port/test', 'utf8'); // FS is in a port
```