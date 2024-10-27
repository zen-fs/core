import { Errno, ErrnoError } from '../error.js';
import type { FileSystemMetadata } from '../filesystem.js';
import type { Stats } from '../stats.js';
import type { Backend } from './backend.js';
import { IndexFS } from './file_index.js';
import type { IndexData } from './file_index.js';

/**
 * Asynchronously download a file as a buffer or a JSON object.
 * Note that the third function signature with a non-specialized type is
 * invalid, but TypeScript requires it when you specialize string arguments to
 * constants.
 * @hidden
 */
async function fetchFile(path: string, type: 'buffer'): Promise<Uint8Array>;
async function fetchFile<T extends object>(path: string, type: 'json'): Promise<T>;
async function fetchFile<T extends object>(path: string, type: 'buffer' | 'json'): Promise<T | Uint8Array>;
async function fetchFile<T extends object>(path: string, type: string): Promise<T | Uint8Array> {
	const response = await fetch(path).catch((e: Error) => {
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
	 * URL to a file index as a JSON file or the file index object itself.
	 * Defaults to `index.json`.
	 */
	index?: string | IndexData;

	/** Used as the URL prefix for fetched files.
	 * Default: Fetch files relative to the index.
	 */
	baseUrl?: string;
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
 * 		"/home/jvilk": { ... },
 * 		"/home/james": { ... }
 * 	}
 * }
 * ```
 *
 * Each entry contains the stats associated with the file.
 */
export class FetchFS extends IndexFS {
	public readonly baseUrl: string;

	public async ready(): Promise<void> {
		if (this._isInitialized) {
			return;
		}
		await super.ready();

		if (this._disableSync) {
			return;
		}

		/**
		 * Iterate over all of the files and cache their contents
		 */
		for (const [path, stats] of this.index.files()) {
			await this.getData(path, stats);
		}
	}

	public constructor({ index = 'index.json', baseUrl = '' }: FetchOptions) {
		// prefix url must end in a directory separator.
		if (baseUrl.at(-1) != '/') {
			baseUrl += '/';
		}

		super(typeof index != 'string' ? index : fetchFile<IndexData>(baseUrl + index, 'json'));

		this.baseUrl = baseUrl;
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: FetchFS.name,
			readonly: true,
		};
	}

	/**
	 * Preload the `path` into the index.
	 */
	public preload(path: string, buffer: Uint8Array): void {
		const stats = this.index.get(path);
		if (!stats) {
			throw ErrnoError.With('ENOENT', path, 'preload');
		}
		if (!stats.isFile()) {
			throw ErrnoError.With('EISDIR', path, 'preload');
		}
		stats.size = buffer.length;
		stats.fileData = buffer;
	}

	/**
	 * @todo Be lazier about actually requesting the data?
	 */
	protected async getData(path: string, stats: Stats): Promise<Uint8Array> {
		if (stats.fileData) {
			return stats.fileData;
		}

		const data = await fetchFile(this.baseUrl + (path.startsWith('/') ? path.slice(1) : path), 'buffer');
		stats.fileData = data;
		return data;
	}

	protected getDataSync(path: string, stats: Stats): Uint8Array {
		if (stats.fileData) {
			return stats.fileData;
		}

		throw new ErrnoError(Errno.ENODATA, '', path, 'getData');
	}
}

const _Fetch = {
	name: 'Fetch',

	options: {
		index: {
			type: ['string', 'object'],
			required: false,
			description: 'URL to a file index as a JSON file or the file index object itself, generated with the make-index script. Defaults to `index.json`.',
		},
		baseUrl: {
			type: 'string',
			required: false,
			description: 'Used as the URL prefix for fetched files. Default: Fetch files relative to the index.',
		},
	},

	isAvailable(): boolean {
		return typeof globalThis.fetch == 'function';
	},

	create(options: FetchOptions) {
		return new FetchFS(options);
	},
} as const satisfies Backend<FetchFS, FetchOptions>;
type _Fetch = typeof _Fetch;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Fetch extends _Fetch {}
export const Fetch: Fetch = _Fetch;
