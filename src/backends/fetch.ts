import { serialize } from 'utilium';
import * as requests from 'utilium/requests.js';
import { Errno, ErrnoError } from '../error.js';
import { err, log_deprecated, warn } from '../log.js';
import { decodeUTF8, encodeDirListing, normalizePath } from '../utils.js';
import { S_IFDIR, S_IFMT, S_IFREG } from '../vfs/constants.js';
import type { Backend, SharedConfig } from './backend.js';
import type { IndexData } from './store/file_index.js';
import { Index } from './store/file_index.js';
import type { StoreFS } from './store/fs.js';
import { IndexFS } from './store/index_fs.js';
import { __inode_sz, Inode } from './store/inode.js';
import type { AsyncMap } from './store/map.js';
import { AsyncMapTransaction } from './store/map.js';
import type { Store } from './store/store.js';

/** Parse and throw */
function parseError(path?: string, fs?: StoreFS): (error: requests.Issue) => never {
	return (error: requests.Issue) => {
		if (!('tag' in error)) throw err(new ErrnoError(Errno.EIO, error.message, path), { fs });

		switch (error.tag) {
			case 'fetch':
				throw err(new ErrnoError(Errno.EREMOTEIO, error.message, path), { fs });
			case 'status':
				throw err(
					new ErrnoError(
						error.response.status > 500 ? Errno.EREMOTEIO : Errno.EIO,
						'Response status code is ' + error.response.status,
						path
					),
					{ fs }
				);
			case 'size':
				throw err(new ErrnoError(Errno.EBADE, error.message, path), { fs });
			case 'buffer':
				throw err(new ErrnoError(Errno.EIO, 'Failed to decode buffer', path), { fs });
		}
	};
}

export class FetchStore implements AsyncMap, Store {
	public readonly flags = ['partial'] as const;

	public readonly name: string = 'nfs';

	declare _fs: IndexFS<FetchStore>;

	public constructor(
		protected index: Index,
		protected baseUrl: string,
		protected requestInit: RequestInit = {},
		protected remoteWrite?: boolean
	) {}

	public *keys(): Iterable<number> {
		for (const inode of this.index.values()) {
			yield inode.ino;
		}
	}

	async get(id: number, offset: number = 0, end?: number): Promise<Uint8Array | undefined> {
		const entry = this.index.entryByID(id);
		if (!entry) return;

		const { path, inode } = entry;

		if (this._fs._paths.has(id)) return serialize(entry.inode);

		if ((inode.mode & S_IFMT) == S_IFDIR) return encodeDirListing(this.index.directoryEntries(path));

		end ??= inode.size;
		if (inode.size == 0 || end - offset == 0) return new Uint8Array(0);

		if (!path) return;

		return await requests
			.get(this.baseUrl + path, { start: offset, end, size: inode.size, warn }, this.requestInit)
			.catch(parseError(path, this._fs))
			.catch(() => undefined);
	}

	public cached(id: number, offset: number = 0, end: number): Uint8Array | undefined {
		const entry = this.index.entryByID(id);
		if (!entry) return;

		const { path, inode } = entry;

		if (this._fs._paths.has(id)) return serialize(entry.inode);

		if ((inode.mode & S_IFMT) == S_IFDIR) return encodeDirListing(this.index.directoryEntries(path));

		end ??= inode.size;
		if (inode.size == 0 || end - offset == 0) return new Uint8Array(0);

		if (!path) return;

		const { data, missing } = requests.getCached(this.baseUrl + path, { start: offset, end, size: inode.size, warn });

		if (!missing.length) return data;

		for (const { start: offset, end } of missing) {
			void this.get(id, offset, end);
		}

		throw ErrnoError.With('EAGAIN', path);
	}

	async set(id: number, body: Uint8Array, offset: number): Promise<void> {
		const [path] = this._fs._paths.get(id) || [];
		if (path) {
			if (body.byteLength == __inode_sz) {
				this.index.get(path)?.update(new Inode(body));
			} else {
				err(`Refusing to update inode ${id} with invalid metadata`);
			}
			return;
		}

		const entry = this.index.entryByID(id);
		if (!entry) return;

		const init = { ...this.requestInit };
		init.headers = new Headers(init.headers);
		init.headers.set('metadata', JSON.stringify(entry.inode.toJSON()));
		await requests.set(this.baseUrl + entry.path, body, { offset, warn, cacheOnly: !this.remoteWrite }, init);
	}

	async delete(id: number): Promise<void> {
		const [path] = this._fs?._paths.get(id) || [];
		if (path) {
			this.index.delete(path);
			return;
		}

		const entry = this.index.entryByID(id);
		if (!entry) return;

		await requests.remove(this.baseUrl + entry.path, { warn, cacheOnly: !this.remoteWrite }, this.requestInit);
	}

	public sync(): Promise<void> {
		return Promise.resolve();
	}

	public transaction(): AsyncMapTransaction {
		return new AsyncMapTransaction(this);
	}
}

/**
 * Configuration options for FetchFS.
 */
export interface FetchOptions extends SharedConfig {
	/**
	 * Options to pass through to fetch calls
	 */
	requestInit?: RequestInit;

	/**
	 * URL to a file index as a JSON file or the file index object itself.
	 * Defaults to `index.json`.
	 */
	index?: string | IndexData;

	/** Used as the URL prefix for fetched files.
	 * Default: Fetch files relative to the index.
	 */
	baseUrl?: string;

	/**
	 * If true, enables writing to the remote (using post and delete)
	 * @default false
	 */
	remoteWrite?: boolean;
}

/* node:coverage disable */
/**
 * A simple filesystem backed by HTTP using the `fetch` API.
 * @internal @deprecated Use the `Fetch` backend, not the internal FS class!
 */
export class FetchFS extends IndexFS<FetchStore> {
	private indexData: IndexData | Promise<IndexData>;

	public readonly baseUrl: string;

	public constructor(
		index: IndexData | string = 'index.json',
		baseUrl: string = '',
		public readonly requestInit?: RequestInit
	) {
		log_deprecated('FetchFS');
		// prefix url must not end in a directory separator.
		if (baseUrl.at(-1) == '/') baseUrl = baseUrl.slice(0, -1);
		const _index = typeof index == 'string' ? new Index() : new Index().fromJSON(index);
		super(new FetchStore(_index, baseUrl), _index);

		this.baseUrl = baseUrl;

		this.indexData =
			typeof index != 'string'
				? index
				: requests
						.get(index, { warn }, requestInit)
						.catch(parseError())
						.then(data => JSON.parse(decodeUTF8(data)));
	}

	public async ready(): Promise<void> {
		if (this._initialized) return;
		await super.ready();

		this.index.fromJSON(await this.indexData);

		if (this._disableSync) return;

		await using tx = this.transaction();

		// Iterate over all of the files and cache their contents
		for (const [path, node] of this.index) {
			if (!(node.mode & S_IFREG)) continue;

			const content = await requests.get(this.baseUrl + path, { warn }, this.requestInit).catch(parseError(path, this));

			await tx.set(node.data, content);
		}

		await tx.commit();
	}
}
/* node:coverage enable */

const _Fetch = {
	name: 'Fetch',

	options: {
		index: { type: ['string', 'object'], required: false },
		baseUrl: { type: 'string', required: false },
		requestInit: { type: 'object', required: false },
		remoteWrite: { type: 'boolean', required: false },
	},

	isAvailable(): boolean {
		return typeof globalThis.fetch == 'function';
	},

	async create(options: FetchOptions) {
		const url = new URL(options.baseUrl || '');
		url.pathname = normalizePath(url.pathname);
		let baseUrl = url.toString();
		if (baseUrl.at(-1) == '/') baseUrl = baseUrl.slice(0, -1);

		options.index ??= 'index.json';

		const index = new Index();

		if (typeof options.index != 'string') {
			index.fromJSON(options.index);
		} else {
			const data = await requests.get(options.index, { warn }, options.requestInit).catch(parseError());
			index.fromJSON(JSON.parse(decodeUTF8(data)));
		}

		const store = new FetchStore(index, baseUrl, options.requestInit, options.remoteWrite);
		const fs = new IndexFS(store, index);
		store._fs = fs;

		if (options.disableAsyncCache) return fs;

		await using tx = fs.transaction();

		// Iterate over all of the files and cache their contents
		for (const [path, node] of index) {
			if (!(node.mode & S_IFREG)) continue;

			const content = await requests.get(baseUrl + path, { warn }, options.requestInit).catch(parseError(path, fs));

			fs._add(node.ino, path);
			await tx.set(node.data, content);
		}

		await tx.commit();

		return fs;
	},
} as const satisfies Backend<StoreFS<FetchStore>, FetchOptions>;
type _Fetch = typeof _Fetch;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Fetch extends _Fetch {}
export const Fetch: Fetch = _Fetch;
