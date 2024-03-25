# ZenFS Worker Backend

[ZenFS](https://github.com/zen-fs/core) backend for usage with workers.

Please read the ZenFS documentation!

For more information, see the [docs](https://zen-fs.github.io/worker).

## Installing

```sh
npm install @zenfs/worker
```

## Usage

> 🛈 The examples are written in ESM. If you are using CJS, you can `require` the package. If running in a browser you can add a script tag to your HTML pointing to the `browser.min.js` and use ZenFS DOM via the global `ZenFS_Worker` object.

You can use DOM backends, though you must register them if you plan on using `configure`:

Main thread:

```js
import { WorkerFS } from '@zenfs/worker';

// Listen for remote file system requests.
WorkerFS.attachRemoteListener(workerObject);
```

Worker thread:

```js
import { configure } from '@zenfs/core';
import { Worker } from '@zenfs/worker';

// Set the remote file system as the root file system.
await configure({
	backend: 'WorkerFS',
	worker: self,
});
```

```js
import { configure } from '@zenfs/core';
import { Worker } from '@zenfs/worker';

await configure({ backend: , worker: seld );

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```
