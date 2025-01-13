import { Errno, ErrnoError } from '../error.js';
import { S_IFREG } from '../vfs/constants.js';
import type { Backend } from './backend.js';
import { InMemoryStore } from './memory.js';
import { StoreFS } from './store/fs.js';
import { Index, type IndexData } from './store/file_index.js';
import type { Store } from './store/store.js';
import { normalizePath } from '../utils.js';

/**
 * Asynchronously download a file as a buffer or a JSON object.
 * Note that the third function signature with a non-specialized type is invalid,
 * but TypeScript requires it when you specialize string arguments to constants.
 * @hidden
 */
async function fetchFile(path: string, type: 'buffer', init?: RequestInit): Promise<Uint8Array>;
async function fetchFile<T extends object>(path: string, type: 'json', init?: RequestInit): Promise<T>;
async function fetchFile<T extends object>(path: string, type: 'buffer' | 'json', init?: RequestInit): Promise<T | Uint8Array>;
async function fetchFile<T extends object>(path: string, type: string, init?: RequestInit): Promise<T | Uint8Array> {
	const response = await fetch(path, init).catch((e: Error) => {
		throw new ErrnoError(Errno.EIO, e.message, path);
	});
	if (!response.ok) {
		throw new ErrnoError(Errno.EIO, 'fetch failed: response returned code ' + response.status, path);
	}
	switch (type) {
		case 'buffer': {
			const arrayBuffer = await response.arrayBuffer().catch((e: Error) => {
				throw new ErrnoError(Errno.EIO, e.message, path);
			});
			return new Uint8Array(arrayBuffer);
		}
		case 'json':
			return response.json().catch((e: Error) => {
				throw new ErrnoError(Errno.EIO, e.message, path);
			}) as Promise<T>;
		default:
			throw new ErrnoError(Errno.EINVAL, 'Invalid download type: ' + type);
	}
}

/**
 * Configuration options for FetchFS.
 */
export interface FetchOptions {
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
	 * A store to use for caching content.
	 * Defaults to an in-memory store
	 */
	cache?: Store;
}

/**
 * A simple filesystem backed by HTTP using the `fetch` API.
 *
 *
 * Index objects look like the following:
 *
 * ```json
 * {
 * 	"version": 1,
 * 	"entries": {
 * 		"/home": { ... },
 * 		"/home/john": { ... },
 * 		"/home/james": { ... }
 * 	}
 * }
 * ```
 *
 * Each entry contains the stats associated with the file.
 */
export class FetchFS extends StoreFS {
	private indexData: IndexData | Promise<IndexData>;

	public async ready(): Promise<void> {
		if (this._initialized) return;
		await super.ready();

		const index = new Index();

		index.fromJSON(await this.indexData);

		await this.loadIndex(index);

		if (this._disableSync) return;

		await using tx = this.store.transaction();

		// Iterate over all of the files and cache their contents
		for (const [path, node] of index) {
			if (!(node.mode & S_IFREG)) continue;

			const content = await fetchFile(this.baseUrl + path, 'buffer', this.requestInit);

			await tx.set(node.data, content);
		}

		await tx.commit();
	}

	public constructor(
		index: IndexData | string = 'index.json',
		cache: Store = new InMemoryStore('fetch'),
		public readonly baseUrl: string = '',
		public readonly requestInit?: RequestInit
	) {
		super(cache);

		// prefix url must end in a directory separator.
		if (baseUrl.at(-1) == '/') this.baseUrl = baseUrl.slice(0, -1);

		this.indexData = typeof index != 'string' ? index : fetchFile<IndexData>(index, 'json', requestInit);
	}
}

const _Fetch = {
	name: 'Fetch',

	options: {
		index: { type: ['string', 'object'], required: false },
		baseUrl: { type: 'string', required: false },
		requestInit: { type: 'object', required: false },
		cache: { type: 'object', required: false },
	},

	isAvailable(): boolean {
		return typeof globalThis.fetch == 'function';
	},

	create(options: FetchOptions) {
		const url = new URL(options.baseUrl || '');
		url.pathname = normalizePath(url.pathname);
		return new FetchFS(options.index, options.cache, url.toString(), options.requestInit);
	},
} as const satisfies Backend<FetchFS, FetchOptions>;
type _Fetch = typeof _Fetch;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Fetch extends _Fetch {}
export const Fetch: Fetch = _Fetch;
