import { ErrnoError, Errno } from '../error.js';
import { NoSyncFile } from '../file.js';
import type { FileSystemMetadata } from '../filesystem.js';
import { Stats } from '../stats.js';
import { type ListingTree, FileIndex, type IndexFileInode, AsyncIndexFS } from './Index.js';
import type { Backend } from './backend.js';

/**
 * @hidden
 */
function convertError(e: Error): never {
	throw new ErrnoError(Errno.EIO, e.message);
}

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
async function fetchFile<T extends object>(path: string, type: 'buffer' | 'json'): Promise<T | Uint8Array> {
	const response = await fetch(path).catch(convertError);
	if (!response.ok) {
		throw new ErrnoError(Errno.EIO, 'fetch failed: response returned code ' + response.status);
	}
	switch (type) {
		case 'buffer':
			const arrayBuffer = await response.arrayBuffer().catch(convertError);
			return new Uint8Array(arrayBuffer);
		case 'json':
			return response.json().catch(convertError) as Promise<T>;
		default:
			throw new ErrnoError(Errno.EINVAL, 'Invalid download type: ' + type);
	}
}

/**
 * Asynchronously retrieves the size of the given file in bytes.
 * @hidden
 */
async function fetchSize(path: string): Promise<number> {
	const response = await fetch(path, { method: 'HEAD' }).catch(convertError);
	if (!response.ok) {
		throw new ErrnoError(Errno.EIO, 'fetch failed: HEAD response returned code ' + response.status);
	}
	return parseInt(response.headers.get('Content-Length') || '-1', 10);
}

/**
 * Configuration options for FetchFS.
 */
export interface FetchOptions {
	/**
	 * URL to a file index as a JSON file or the file index object itself.
	 * Defaults to `index.json`.
	 */
	index?: string | ListingTree;

	/** Used as the URL prefix for fetched files.
	 * Default: Fetch files relative to the index.
	 */
	baseUrl?: string;
}

/**
 * A simple filesystem backed by HTTP using the fetch API.
 *
 *
 * Listings objects look like the following:
 *
 * ```json
 * {
 *   "home": {
 *     "jvilk": {
 *       "someFile.txt": null,
 *       "someDir": {
 *         // Empty directory
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * This example has the folder `/home/jvilk` with subfile `someFile.txt` and subfolder `someDir`.
 */
export class FetchFS extends AsyncIndexFS<Stats> {
	public readonly prefixUrl: string;

	protected _init: Promise<void>;

	protected async _initialize(index: string | ListingTree): Promise<void> {
		if (typeof index != 'string') {
			this._index = FileIndex.FromListing(index);
			return;
		}

		try {
			const response = await fetch(index);
			this._index = FileIndex.FromListing((await response.json()) as ListingTree);
		} catch (e) {
			throw new ErrnoError(Errno.EINVAL, 'Invalid or unavailable file listing tree');
		}
	}

	public async ready(): Promise<void> {
		await this._init;
	}

	constructor({ index = 'index.json', baseUrl = '' }: FetchOptions) {
		super({});

		// prefix url must end in a directory separator.
		if (baseUrl.at(-1) != '/') {
			baseUrl += '/';
		}
		this.prefixUrl = baseUrl;

		this._init = this._initialize(index);
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: FetchFS.name,
			readonly: true,
		};
	}

	public empty(): void {
		for (const file of this._index.files()) {
			delete file.data!.fileData;
		}
	}

	/**
	 * Special function: Preload the given file into the index.
	 * @param path
	 * @param buffer
	 */
	public preloadFile(path: string, buffer: Uint8Array): void {
		const inode = this._index.get(path)!;
		if (!inode) {
			throw ErrnoError.With('ENOENT', path, 'preloadFile');
		}
		if (!inode.isFile()) {
			throw ErrnoError.With('EISDIR', path, 'preloadFile');
		}
		const stats = inode.data!;
		stats.size = buffer.length;
		stats.fileData = buffer;
	}

	protected async statFileInode(inode: IndexFileInode<Stats>, path: string): Promise<Stats> {
		const stats = inode.data!;
		// At this point, a non-opened file will still have default stats from the listing.
		if (stats.size < 0) {
			stats.size = await this._fetchSize(path);
		}

		return stats;
	}

	protected async openFileInode(inode: IndexFileInode<Stats>, path: string, flag: string): Promise<NoSyncFile<this>> {
		const stats = inode.data!;
		// Use existing file contents. This maintains the previously-used flag.
		if (stats.fileData) {
			return new NoSyncFile(this, path, flag, new Stats(stats), stats.fileData);
		}
		// @todo be lazier about actually requesting the file
		const data = await this._fetchFile(path, 'buffer');
		// we don't initially have file sizes
		stats.size = data.length;
		stats.fileData = data;
		return new NoSyncFile(this, path, flag, new Stats(stats), data);
	}

	private _getRemotePath(filePath: string): string {
		if (filePath.charAt(0) === '/') {
			filePath = filePath.slice(1);
		}
		return this.prefixUrl + filePath;
	}

	/**
	 * Asynchronously download the given file.
	 */
	protected _fetchFile(path: string, type: 'buffer'): Promise<Uint8Array>;
	protected _fetchFile(path: string, type: 'json'): Promise<object>;
	protected _fetchFile(path: string, type: 'buffer' | 'json'): Promise<object>;
	protected _fetchFile(path: string, type: 'buffer' | 'json'): Promise<object> {
		return fetchFile(this._getRemotePath(path), type);
	}

	/**
	 * Only requests the HEAD content, for the file size.
	 */
	protected _fetchSize(path: string): Promise<number> {
		return fetchSize(this._getRemotePath(path));
	}
}

export const Fetch = {
	name: 'Fetch',

	options: {
		index: {
			type: ['string', 'object'],
			required: false,
			description: 'URL to a file index as a JSON file or the file index object itself, generated with the make_http_index script. Defaults to `index.json`.',
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
