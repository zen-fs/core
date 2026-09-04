# ZenFS

ZenFS is a cross-platform library that emulates the [Node.js filesystem API](http://nodejs.org/api/fs.html).
It works using a system of backends, which are used by ZenFS to store and retrieve data.
ZenFS should cover the full API surface of the latest Node.js version, though complex changes may lag a little bit.

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
- @zenfs/dom: `WebAccess` (Web [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)/OPFS), `IndexedDB`, `WebStorage` (`localStorage`/`sessionStorage`), `XML` (DOM elements)
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

> [!IMPORTANT]
> **[Check out the ZenFS docs!](https://zenfs.dev/guides/using-zenfs/)**

```js
import { fs } from '@zenfs/core'; // You can also use the default export

fs.writeFileSync('/test.txt', 'You can do this anywhere, including browsers!');

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

A single `InMemory` backend is created by default, mounted on `/`. To use different backends, and to
mount more than one, configure ZenFS with `configure`. This mounts a zip file to `/mnt/zip`,
in-memory storage to `/tmp`, and IndexedDB to `/home`:

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

The `fs/promises` API is available from `@zenfs/core/promises`, as the `promises` export, or as
`fs.promises`.

For the full usage guide, see **[the documentation](https://zenfs.dev/guides/using-zenfs/)**.
This includes mounting at runtime, contexts and permissions, devices, and the `node:*`module emulation.

## Bundling

ZenFS exports a drop-in for Node's `fs` module, so you can use it for your bundler of preference using the default export.
See [COPYING.md](./COPYING.md) for more info.

## Sponsors

A huge thank you to [deco.cx](https://github.com/deco-cx) for sponsoring ZenFS and helping to make this possible.

## Contact and Support

You can reach out [on Discord](https://zenfs.dev/discord) or by emailing jp@zenfs.dev
