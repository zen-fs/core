# BrowserFS

BrowserFS is an in-browser file system that emulates the [Node JS file system API](http://nodejs.org/api/fs.html) and supports storing and retrieving files from various backends. BrowserFS also integrates nicely into the Emscripten file system.

## Backends

BrowserFS is highly extensible, and includes many builtin filesystem backends:

-   `InMemory`: Stores files in-memory. It is a temporary file store that clears when the user navigates away.
-   `OverlayFS`: Mount a read-only file system as read-write by overlaying a writable file system on top of it. Like Docker's overlayfs, it will only write changed files to the writable file system.
-   `AsyncMirror`: Use an asynchronous backend synchronously. Invaluable for Emscripten; let your Emscripten applications write to larger file stores with no additional effort!
    -   `AsyncMirror` loads the entire contents of the async file system into a synchronous backend during construction. It performs operations synchronous file system and then queues them to be mirrored onto the asynchronous backend.
-   `FolderAdapter`: Wraps a file system, and scopes all interactions to a subfolder of that file system.

More backends can be defined by separate libraries, so long as they extend they implement `BrowserFS.FileSystem`. Multiple backends can be active at once at different locations in the directory hierarchy.

BrowserFS supports a number of other backends (as `@browserfs/fs-[name]`).

For more information, see the [API documentation for BrowserFS](https://browser-fs.github.io/core).

## Installing

```sh
npm install @browserfs/core
```

## Building

-   Make sure you have Node and NPM installed. You must have Node v18 or newer.
-   Install dependencies with `npm install`
-   Build using `npm run build`
-   You can find the built code in `dist`.

## Usage

> 🛈 The examples are written in ESM. If you are using CJS, you can `require` the package. If running in a browser you can add a script tag to your HTML pointing to the `browser.min.js` and use BrowserFS via the global `BrowserFS` object.

```js
import fs from '@browserfs/core';

fs.writeFileSync('/test.txt', 'Cool, I can do this in the browser!');

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

#### Using different backends

A `InMemory` backend is created by default. If you would like to use a different one, you must configure BrowserFS. It is recommended to do so using the `configure` function. Here is an example using the `Storage` backend from `@browserfs/fs-dom`:

```js
import { configure, fs, registerBackend } from '@browserfs/core';
import { StorageFileSystem } from '@browserfs/fs-dom';
registerBackend(StorageFileSystem);

// you can also add a callback as the last parameter instead of using promises
await configure({ fs: 'Storage' });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

#### Using multiple backends

You can use multiple backends by passing an object to `configure` which maps paths to file systems. The following example mounts a zip file to `/zip`, in-memory storage to `/tmp`, and IndexedDB storage to `/home` (note that `/` has the default in-memory backend):

```js
import { configure, registerBackend } from '@browserfs/core';
import { IndexedDBFileSystem } from '@browserfs/fs-dom';
import { ZipFS } from '@browserfs/fs-zip';
import Buffer from 'buffer';
registerBackend(IndexedDBFileSystem, ZipFS);

const zipData = await (await fetch('mydata.zip')).arrayBuffer();

await configure({
	'/mnt/zip': {
		fs: 'ZipFS',
		options: {
			zipData: Buffer.from(zipData)
		}
	},
	'/tmp': 'InMemory',
	'/home': 'IndexedDB',
};
```

#### FS Promises API

The FS promises API is exposed as `promises`.

```js
import { configure, promises, registerBackend } from '@browserfs/core';
import { IndexedDBFileSystem } from '@browserfs/fs-dom';
registerBackend(IndexedDBFileSystem);

await configure({ '/': 'IndexedDB' });

const exists = await promises.exists('/myfile.txt');
if (!exists) {
	await promises.write('/myfile.txt', 'Lots of persistant data');
}
```

BrowserFS does _not_ provide a seperate method for importing promises in its built form. If you are using Typescript, you can import the promises API from source code (perhaps to reduce you bundle size). Doing so it not recommended as the files may be moved without notice.

#### Using asynchronous backends synchronously

You may have noticed that attempting to use a synchronous method on an asynchronous backend (e.g. IndexedDB) results in a "not supplied" error (`ENOTSUP`). If you wish to use an asynchronous backend synchronously you need to wrap it in an `AsyncMirror`:

```js
import { configure, fs } from '@browserfs/core';
import { IndexedDBFileSystem } from '@browserfs/fs-dom';
registerBackend(IndexedDBFileSystem);

await configure({
	'/': { fs: 'AsyncMirror', options: { sync: { fs: 'InMemory' }, async: { fs: 'IndexedDB' } } }
});

fs.writeFileSync('/persistant.txt', 'My persistant data'); // This fails if you configure the FS as IndexedDB
```

### Advanced usage

#### Creating backends

If you would like to create backends without configure, you may do so by importing the backend's class and calling its `Create` method. You can import the backend directly or with `backends`:

```js
import { configure, backends, InMemory } from '@browserfs/core';

console.log(backends.InMemory === InMemory) // they are the same

const inMemoryFS = await InMemory.Create();
```

> ⚠ Instances of backends follow the ***internal*** BrowserFS API. You should never use a backend's method unless you are extending a backend.

Coming soon:
```js
import { configure, InMemory } from '@browserfs/core';

const inMemoryFS = new InMemory();
await inMemoryFS.whenReady();
```

#### Mounting

If you would like to mount and unmount backends, you can do so using the `mount` and `umount` functions:

```js
import { fs, InMemory } from '@browserfs/core';

const inMemoryFS = await InMemory.Create(); // create an FS instance

fs.mount('/tmp', inMemoryFS); // mount

fs.umount('/tmp'); // unmount /tmp
```

This could be used in the "multiple backends" example like so:

```js
import { IndexedDBFileSystem } from '@browserfs/fs-dom';
import { ZipFS } from '@browserfs/fs-zip';
import Buffer from 'buffer';
registerBackend(IndexedDBFileSystem);

await configure({
	'/tmp': 'InMemory',
	'/home': 'IndexedDB',
};

fs.mkdirSync('/mnt');

const res = await fetch('mydata.zip');
const zipData = Buffer.from(await res.arrayBuffer());
const zipFs = await ZipFS.Create({ zipData });
fs.mount('/mnt/zip', zipFs);

// do stuff with the mounted zip

fs.umount('/mnt/zip'); // finished using the zip
```

## Using with bundlers

BrowserFS exports a drop-in for Node's `fs` module (up to the version of `@types/node` in package.json), so you can use it for your bundler of preference using the default export.

#### ESBuild

tsconfig.json

```json
{
	...
	"paths": {
		"fs": ["node_modules/browserfs/dist/index.js"]
	}
	...
}
```

[Why tsconfig.json?](https://stackoverflow.com/a/71935037/17637456)

Webpack:

```js
module.exports = {
	// ...
	resolve: {
		alias: {
			fs: require.resolve('browserfs'),
		},
	},
	// ...
};
```

Rollup:

```js
import alias from '@rollup/plugin-alias';

export default {
	// ...
	plugins: [
		alias({
			entries: [{ find: 'fs', replacement: 'browserfs' }],
		}),
	],
	// ...
};
```

## Using with Emscripten

You can use any _synchronous_ BrowserFS file systems with Emscripten.

```js
import { EmscriptenFSPlugin } from '@browserfs/fs-emscripten';
const BFS = new EmscriptenFSPlugin(); // Create a BrowserFS Emscripten FS plugin.
FS.createFolder(FS.root, 'data', true, true); // Create the folder to turn into a mount point.
FS.mount(BFS, { root: '/' }, '/data'); // Mount BFS's root folder into /data.
```

If you want to use an asynchronous backend, you must wrap it in an `AsyncMirror`.

### Testing

Run unit tests with `npm test`.

### Citing

BrowserFS is a component of the [Doppio](http://doppiojvm.org/) and [Browsix](https://browsix.org/) research projects from the PLASMA lab at the University of Massachusetts Amherst. If you decide to use BrowserFS in a project that leads to a publication, please cite the academic papers on [Doppio](https://dl.acm.org/citation.cfm?doid=2594291.2594293) and [Browsix](https://dl.acm.org/citation.cfm?id=3037727):

> John Vilk and Emery D. Berger. Doppio: Breaking the Browser Language Barrier. In
> _Proceedings of the 35th ACM SIGPLAN Conference on Programming Language Design and Implementation_
> (2014), pp. 508–518.

```bibtex
@inproceedings{VilkDoppio,
	author		= {John Vilk and
							 Emery D. Berger},
	title		 = {{Doppio: Breaking the Browser Language Barrier}},
	booktitle = {Proceedings of the 35th {ACM} {SIGPLAN} Conference on Programming Language Design and Implementation},
	pages		 = {508--518},
	year			= {2014},
	url			 = {http://doi.acm.org/10.1145/2594291.2594293},
	doi			 = {10.1145/2594291.2594293}
}
```

> Bobby Powers, John Vilk, and Emery D. Berger. Browsix: Bridging the Gap Between Unix and the Browser. In _Proceedings of the Twenty-Second International Conference on Architectural Support for Programming Languages and Operating Systems_ (2017), pp. 253–266.

```bibtex
@inproceedings{PowersBrowsix,
	author		= {Bobby Powers and
							 John Vilk and
							 Emery D. Berger},
	title		 = {{Browsix: Bridging the Gap Between Unix and the Browser}},
	booktitle = {Proceedings of the Twenty-Second International Conference on Architectural
							 Support for Programming Languages and Operating Systems},
	pages		 = {253--266},
	year			= {2017},
	url			 = {http://doi.acm.org/10.1145/3037697.3037727},
	doi			 = {10.1145/3037697.3037727}
}
```

### License

BrowserFS is licensed under the MIT License. See `LICENSE` for details.
