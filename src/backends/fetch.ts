import { serialize } from 'utilium';
import { Errno, ErrnoError } from '../error.js';
import { S_IFMT, S_IFREG } from '../vfs/constants.js';
import type { Backend } from './backend.js';
import type { IndexData } from './file_index.js';
import { IndexFS } from './file_index.js';
import { InMemoryStore } from './memory.js';
import type { Store } from './store/store.js';

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
	store?: Store;
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
export class FetchFS extends IndexFS<Store> {
	public async ready(): Promise<void> {
		if (this._isInitialized) {
			return;
		}
		await super.ready();

		if (this._disableSync) {
			return;
		}

		using tx = this.store.transaction();

		/**
		 * Iterate over all of the files and cache their contents
		 */
		for (const [path, node] of this.index) {
			if (!(node.mode & S_IFREG)) return;

			const content = await this.fetch(path, '[init]');

			tx.setSync(node.ino, serialize(node));
			tx.setSync(node.data, content);
		}

		tx.commitSync();
	}

	public constructor(
		index: IndexData | string = 'index.json',
		store: Store = new InMemoryStore('fetch'),
		public readonly baseUrl: string = '',
		public readonly requestInit?: RequestInit
	) {
		// prefix url must end in a directory separator.
		if (baseUrl.at(-1) != '/') {
			baseUrl += '/';
		}

		const indexData = typeof index != 'string' ? index : fetchFile<IndexData>(index, 'json', requestInit);

		super(store, indexData);
	}

	/* public async openFile(path: string, flag: string): Promise<File> {
		const file = await super.openFile(path, flag);
	}

	public openFileSync(path: string, flag: string): File {
		super.openFileSync(path, flag);
	} */

	/**
	 * @todo Be lazier about actually requesting the data?
	 */
	protected async fetch(path: string, syscall: string): Promise<Uint8Array> {
		const node = this.index.get(path);
		if (!node) throw ErrnoError.With('ENOENT', path, syscall);
		if ((node.mode & S_IFMT) != S_IFREG) throw ErrnoError.With('EISDIR', path, syscall);

		const url = this.baseUrl + (path.startsWith('/') ? path.slice(1) : path);
		const content = await fetchFile(url, 'buffer', this.requestInit);

		return content;
	}
}

const _Fetch = {
	name: 'Fetch',

	options: {
		index: { type: ['string', 'object'], required: false },
		baseUrl: { type: 'string', required: false },
		requestInit: { type: 'object', required: false },
		store: { type: 'object', required: false },
	},

	isAvailable(): boolean {
		return typeof globalThis.fetch == 'function';
	},

	create(options: FetchOptions) {
		return new FetchFS(options.index, options.store, options.baseUrl, options.requestInit);
	},
} as const satisfies Backend<FetchFS, FetchOptions>;
type _Fetch = typeof _Fetch;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Fetch extends _Fetch {}
export const Fetch: Fetch = _Fetch;
