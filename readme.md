# ZenFS Port Backend

[ZenFS](https://github.com/zen-fs/core) backend for usage with ports and workers.

Please read the ZenFS documentation!

For more information, see the [docs](https://zen-fs.github.io/port).

## Installing

```sh
npm install @zenfs/port
```

## Usage

> [!NOTE]
> The examples are written in ESM. If you are using CJS, you can `require` the package. If in a browser you can add a script tag to your HTML pointing to the `browser.min.js` and use ZenFS DOM via the global `ZenFS_Port` object.

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
import { fs } from '@zenfs/core';
import { attach } from '@zenfs/port';
import { parentPort } from 'node:worker_threads';

attach(parentPort, fs.mounts.get('/'));
```

If you are using using web workers, you would use `self` instead of importing `parentPort` in the worker, and would not need to import `Worker` in the main thread.

#### Using with multiple ports on the same thread

```ts
import { InMemory, fs, resolveBackendConfig } from '@zenfs/core';
import { Port, attach } from '@zenfs/port';
import { MessageChannel } from 'node:worker_threads';

const { port1, port2 } = new MessageChannel();

fs.mount('/tmp', await resolveBackendConfig({ backend: InMemory, name: 'tmp' }));
attach(port2, fs.mounts.get('/tmp'));
fs.mount('/port', await resolveBackendConfig({ backend: Port, port: port1 }));
console.log('/port');

const content = 'FS is in a port';

await fs.promises.writeFile('/port/test', content);

fs.readFileSync('/tmp/test', 'utf8'); // FS is in a port
await fs.promises.readFile('/port/test', 'utf8'); // FS is in a port
```
