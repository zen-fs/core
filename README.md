# BrowserFS

BrowserFS is an in-browser file system that emulates the [Node JS file system API](http://nodejs.org/api/fs.html) and supports storing and retrieving files from various backends. BrowserFS also integrates nicely into the Emscripten file system.

### Releases and compatibility going forward

I am currently working on getting NPM permissions from John Vilk (jvilk), the creator of BrowserFS. He is very busy with life and does not have the time to work on BrowserFS. That includes adminministration actions like giving me the aforementioned permissions. Until I get permissions to publish BrowserFS, no new releases of the `browserfs` package can be published on NPM. You will need to build _from source_ for now.

In addition, I am working on obtaining the browserfs organization names on GitHub and NPM. Once that is done, the repository will be moved to [BrowserFS/BrowserFS](https://github.com/BrowserFS/BrowserFS) and some package reorgnization will be done. The new structure will look like this:

| NPM package           | Description                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| @browserfs/core       | Includes the core code for BrowserFS and the core backends: InMemory, OverlayFS, AsyncMirror, FolderAdapter, WorkerFS |
| @browserfs/fetch      | `Fetch`/`HTTPRequest`/`XMLHTTPRequest` backend (potentially moved into core)                                          |
| @browserfs/dom        | Backends which require DOM APIs (e.g. `LocalStorage` and `IndexedDB`)                                                 |
| @browserfs/emscripten | `Emscripten` backend                                                                                                  |
| @browserfs/zip        | `ZipFS` backend (will be updated to include explode, unreduce, and unshrink)                                          |
| @browserfs/iso        | `IsoFS` backend                                                                                                       |
| @browserfs/dropbox    | `Dropbox` backend                                                                                                     |

This will be done so users of browserfs don't bundle significantly more code than they actually need and so the library's bundles are smaller.

\- Vortex (current BrowserFS maintainer)

## Backends

BrowserFS is highly extensible, and ships with many filesystem backends:

Core dackends:

-   `InMemory`: Stores files in-memory. It is a temporary file store that clears when the user navigates away.
-   `OverlayFS`: Mount a read-only file system as read-write by overlaying a writable file system on top of it. Like Docker's overlayfs, it will only write changed files to the writable file system.
-   `AsyncMirror`: Use an asynchronous backend synchronously. Invaluable for Emscripten; let your Emscripten applications write to larger file stores with no additional effort!
    -   `AsyncMirror` loads the entire contents of the async file system into a synchronous backend during construction. It performs operations synchronous file system and then enqueues them to be mirrored onto the asynchronous backend.
-   `WorkerFS`: Lets you mount the BrowserFS file system configured in the main thread in a Worker or the other way around.
-   `FolderAdapter`: Wraps a file system, and scopes all interactions to a subfolder of that file system.

DOM backends:

-   `LocalStorage`: Stores files in the browser's `localStorage`.
-   `IndexedDB`: Stores files into the browser's `IndexedDB` object database.
-   `HTTPRequest`: Downloads files on-demand from a webserver using `fetch`.

-   `ZipFS`: Read-only zip file-backed FS. Lazily decompresses files as you access them.
    -   Supports DEFLATE out-of-the-box.
    -   [The `browserfs-zipfs-extras` package](https://github.com/browser-fs/core-zipfs-extras) adds support for EXPLODE, UNREDUCE, and UNSHRINK.
-   `IsoFS`: Mount an .iso file into the file system.
    -   Supports Microsoft Joliet and Rock Ridge extensions to the ISO9660 standard.
-   `Dropbox`: Stores files into the user's Dropbox account.
    -   Note: You provide this filesystem with an authenticated [DropboxJS V2 JS SDK client](https://github.com/dropbox/dropbox-sdk-js).
-   `Emscripten`: Lets you mount Emscripten file systems inside BrowserFS.

More backends can be defined by separate libraries, so long as they extend they implement `BrowserFS.FileSystem`. Multiple backends can be active at once at different locations in the directory hierarchy.

For more information, see the [API documentation for BrowserFS](https://jvilk.com/browserfs/2.0.0-beta/index.html).

## Installing

```sh
npm i browserfs
```

> ⚠ Installing BrowserFS from NPM will not install the latest BrowserFS. See [Releases and compatibility going forward](#releases-and-compatibility-going-forward) for more details.

## Building

-   Make sure you have Node and NPM installed. You must have Node v18 or newer.
-   Install dependencies with `npm install`
-   Build using `npm run build`
-   You can find the built code in `dist`.

## Usage

> 🛈 The examples are written in ESM. If you aren't using ESM, you can add `<script src="browserfs.min.js"></script>` to your HTML and use BrowserFS via the global `BrowserFS` object.

```js
import { fs } from 'browserfs';

fs.writeFileSync('/test.txt', 'Cool, I can do this in the browser!');

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

#### Using different backends

A `InMemory` backend is created by default. If you would like to use a different one, you must configure BrowserFS. It is recommended to do so using the `configure` function. Here is an example using the `LocalStorage` backend:

```js
import { configure, fs } from 'browserfs';

// you can also add a callback as the last parameter instead of using promises
await configure({ fs: 'LocalStorage' });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

#### Using multiple backends

You can use multiple backends by passing an object to `configure` which maps paths to file systems. The following example mounts a zip file to `/zip`, in-memory storage to `/tmp`, and IndexedDB browser-local storage to `/home` (note that `/` has the default in-memory backend):

```js
import { configure } from 'browserfs';
import Buffer from 'buffer';

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
import { configure, promises } from 'browserfs';

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
import { configure, fs } from 'browserfs';

await configure({
	'/': { fs: 'AsyncMirror', options: { sync: { fs: 'InMemory' }, async: { fs: 'IndexedDB' } } }
});

fs.writeFileSync('/persistant.txt', 'My persistant data'); // This fails if you configure the FS as IndexedDB
```

### Advanced usage

#### Creating backends

If you would like to create backends without configure, you may do so by importing the backend's class and calling its `Create` method. You can import the backend directly or with `backends`:

```js
import { configure, backends, InMemory } from 'browserfs';

console.log(backends.InMemory === InMemory) // they are the same

const inMemoryFS = await InMemory.Create();
```

> ⚠ Instances of backends follow the ***internal*** BrowserFS API. You should never use a backend methods unless you are extending a backend.

Coming soon:
```js
import { configure, InMemory } from 'browserfs';

const inMemoryFS = new InMemory();
await inMemoryFS.whenReady();
```

#### Mounting

If you would like to mount and unmount backends, you can do so using the `mount` and `umount` functions:

```js
import { fs, InMemory } from 'browserfs';

const inMemoryFS = await InMemory.Create(); // create an FS instance

fs.mount('/tmp', inMemoryFS); // mount

fs.umount('/tmp'); // unmount /tmp
```

This could be used in the "multiple backends" example like so:

```js
import { configure, fs, ZipFS } from 'browserfs';
import Buffer from 'buffer';

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

BrowserFS exports a drop-in for Node's `fs` module (up to the version of `@types/node` in package.json), so you can use it for your bundler of preference with a simple "shim" script:

shim.js

```js
import { fs } from 'browserfs';
export default fs;
```

#### ESBuild

tsconfig.json

```json
{
	...
	"paths": {
		"fs": ["./your/path/to/shim.js"]
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
			fs: './your/path/to/shim.js',
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
			entries: [{ find: 'fs', replacement: './your/path/to/shim.js' }],
		}),
	],
	// ...
};
```

## Using with Emscripten

You can use any _synchronous_ BrowserFS file systems with Emscripten.

```js
import { EmscriptenFS } from 'browserfs';
const BFS = new EmscriptenFS(); // Create a BrowserFS Emscripten FS plugin.
FS.createFolder(FS.root, 'data', true, true); // Create the folder that we'll turn into a mount point.
FS.mount(BFS, { root: '/' }, '/data'); // Mount BFS's root folder into the '/data' folder.
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
