# ZenFS DOM Backends

[ZenFS](https://github.com/zen-fs/core) backends for DOM APIs. DOM APIs are _only_ available natively in browsers.

Please read the ZenFS documentation!

## Backends

-   `HTTPRequest`: Downloads files on-demand from a webserver using `fetch`.
-   `Storage`: Stores files in a `Storage` object, like `localStorage` and `seesionStorage`.
-   `IndexedDB`: Stores files into an `IndexedDB` object database.
-   `WorkerFS`: Lets you mount the ZenFS file system configured in the main thread in a WebWorker, or the other way around!

For more information, see the [API documentation](https://zen-fs.github.io/dom).

## Installing

```sh
npm install @zenfs/dom
```

## Usage

> 🛈 The examples are written in ESM. If you are using CJS, you can `require` the package. If running in a browser you can add a script tag to your HTML pointing to the `browser.min.js` and use ZenFS DOM via the global `ZenFS_DOM` object.

You can use DOM backends, though you must register them if you plan on using `configure`:

```js
import { configure, fs, registerBackend } from '@zenfs/core';
import { Storage } from '@zenfs/dom';

registerBackend(Storage);
await configure({ fs: 'Storage', options: { storage: localStorage } });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```
