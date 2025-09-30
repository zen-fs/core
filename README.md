# ZenFS

ZenFS is a cross-platform library that emulates the [Node.js filesystem API](http://nodejs.org/api/fs.html).
It works using a system of backends, which are used by ZenFS to store and retrieve data.
ZenFS can also integrate with other tools.

## Backends

ZenFS is modular and easily extended. The core includes some built-in backends:

- `InMemory`: Stores files in-memory. This is cleared when the runtime ends (e.g. a user navigating away from a web page or a Node process exiting)
- `CopyOnWrite`: Use readable and writable file systems with [copy-on-write](https://en.wikipedia.org/wiki/Copy-on-write).
- `Fetch`: Downloads files over HTTP with the `fetch` API
- `Port`: Interacts with a remote over a `MessagePort`-like interface (e.g. a worker)
- `Passthrough`: Use an existing `node:fs` interface with ZenFS
- `SingleBuffer`: A backend contained within a single buffer. Can be used for synchronous multi-threaded operations using `SharedArrayBuffer`

ZenFS supports a number of other backends.
Many are provided as separate packages under `@zenfs`.
More backends can be defined by separate libraries by extending the `FileSystem` class and providing a `Backend` object.

You can find all of the packages available over on [NPM](https://www.npmjs.com/org/zenfs). Below is a list of the backends included with some of them:

- @zenfs/archives: `Zip`, `Iso`
- @zenfs/cloud: `Dropbox`, `GoogleDrive`, `S3Bucket`
- @zenfs/dom: `WebAccess` (Web [File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)/OPFS), `IndexedDB`, `WebStorage` (`localStorage`/`sessionStorage`), `XML` (DOM elements)
- @zenfs/emscripten: `Emscripten` and a plugin for Emscripten's file system API

As an added bonus, all ZenFS backends support synchronous operations.
Additionally, all of the backends included with the core are cross-platform.

For more information, see the [docs](https://zenfs.dev/core).

## Installing

```sh
npm install @zenfs/core
```

If you're using ZenFS, especially for big projects, please consider supporting the project.
Thousands of hours have been dedicated to its development.
Your financial support would go a long way toward improving ZenFS and its community.

## Usage

```js
import { fs } from '@zenfs/core'; // You can also use the default export

fs.writeFileSync('/test.txt', 'You can do this anywhere, including browsers!');

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

#### Using different and/or multiple backends

A single `InMemory` backend is created by default, mounted on `/`.

You can configure ZenFS to use a different backend and mount multiple backends. It is strongly recommended to do so using the `configure` function.

You can use multiple backends by passing an object to `configure` which maps paths to file systems.

The following example mounts a zip file to `/zip`, in-memory storage to `/tmp`, and IndexedDB to `/home`. Note that `/` has the default in-memory backend.

```js
import { configure, InMemory } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';
import { Zip } from '@zenfs/archives';

const res = await fetch('mydata.zip');

await configure({
	mounts: {
		'/mnt/zip': { backend: Zip, data: await res.arrayBuffer() },
		'/tmp': InMemory,
		'/home': IndexedDB,
	},
});
```

Note that while you aren't required to use absolute paths for the keys of `mounts`, it is a good practice to do so.

> [!TIP]
> When configuring a mount point, you can pass in
>
> 1. A `Backend` object, if the backend has no required options
> 2. An object that has the options accepted by the backend and a `backend` property which is a `Backend` object
> 3. A `FileSystem` instance

Here is an example that mounts the `WebStorage` backend from `@zenfs/dom` on `/`:

```js
import { configureSingle, fs } from '@zenfs/core';
import { WebStorage } from '@zenfs/dom';

await configureSingle({ backend: WebStorage });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

#### FS Promises

The FS promises API is exposed as `promises`.

```js
import { configureSingle } from '@zenfs/core';
import { exists, writeFile } from '@zenfs/core/promises';
import { IndexedDB } from '@zenfs/dom';

await configureSingle({ backend: IndexedDB });

const exists = await exists('/myfile.txt');
if (!exists) {
	await writeFile('/myfile.txt', 'Lots of persistent data');
}
```

> [!NOTE]
> You can import the promises API using:
>
> 1. Exports from `@zenfs/core/promises`
> 2. The `promises` export from `@zenfs/core`
> 3. `fs.promises` on the exported `fs` from `@zenfs/core`.

#### Mounting and unmounting, creating backends

If you would like to create backends without configure (e.g. to do something dynamic at runtime), you may do so by importing the backend and calling `resolveMountConfig` with it.

You can then mount and unmount the backend instance by using `mount` and `umount`.

```js
import { configure, resolveMountConfig, InMemory } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';
import { Zip } from '@zenfs/archives';

await configure({
	mounts: {
		'/tmp': InMemory,
		'/home': IndexedDB,
	},
});

fs.mkdirSync('/mnt/zip', { recursive: true });

const res = await fetch('mydata.zip');
const zipfs = await resolveMountConfig({ backend: Zip, data: await res.arrayBuffer() });
fs.mount('/mnt/zip', zipfs);

// do stuff with the mounted zip

fs.umount('/mnt/zip'); // finished using the zip
```

> [!CAUTION]
> Instances of backends follow the _internal_ API. You should never use a backend's methods unless you are extending a backend.

### Devices and device files

ZenFS includes support for device files. These are designed to follow Linux's device file behavior, for consistency and ease of use. Check out the [Devices and Device Drivers](https://zenfs.dev/core/documents/Devices_and_Device_Drivers) documentation for more information.

## Bundling

ZenFS exports a drop-in for Node's `fs` module, so you can use it for your bundler of preference using the default export.

> [!IMPORTANT]
> See [COPYING.md](./COPYING.md)

## Sponsors

A huge thank you to [deco.cx](https://github.com/deco-cx) for sponsoring ZenFS and helping to make this possible.

## Contact and Support

You can reach out [on Discord](https://zenfs.dev/discord) or by emailing jp@zenfs.dev
