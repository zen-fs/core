import { serialize } from 'utilium';
import { Errno, ErrnoError } from '../error.js';
import { err, log_deprecated } from '../log.js';
import { growBuffer, normalizePath } from '../utils.js';
import { S_IFREG } from '../vfs/constants.js';
import type { Backend, SharedConfig } from './backend.js';
import type { IndexData } from './store/file_index.js';
import { Index } from './store/file_index.js';
import { StoreFS } from './store/fs.js';
import type { Store } from './store/store.js';
import { Transaction } from './store/store.js';

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
		throw err(new ErrnoError(Errno.EIO, e.message, path));
	});
	if (!response.ok) {
		throw err(new ErrnoError(Errno.EIO, 'fetch failed: response returned code ' + response.status, path));
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
			throw err(new ErrnoError(Errno.EINVAL, 'Invalid download type: ' + type));
	}
}

export class FetchTransaction extends Transaction<FetchStore> {
	protected asyncDone: Promise<unknown> = Promise.resolve();

	/** @internal @hidden */
	async(promise: Promise<unknown>): void {
		this.asyncDone = this.asyncDone.then(() => promise);
	}

	/** @internal @hidden */
	cache: Map<number, Uint8Array | undefined> = this.store.cache;

	public keys(): Promise<Iterable<number>> {
		return Promise.resolve(this.cache.keys());
	}

	public keysSync(): Iterable<number> {
		return this.cache.keys();
	}

	public async get(id: number): Promise<Uint8Array | undefined> {
		if (this.cache.has(id)) return this.cache.get(id);

		const data = await this.store.get(id);
		this.cache.set(id, data);
		return data;
	}

	public getSync(id: number): Uint8Array | undefined {
		if (this.cache.has(id)) return this.cache.get(id);
		this.async(this.get(id).then(v => this.cache.set(id, v)));
		throw ErrnoError.With('EAGAIN', undefined, 'AsyncTransaction.getSync');
	}

	public async set(id: number, data: Uint8Array, offset?: number): Promise<number> {
		if (offset) {
			const buffer = growBuffer((await this.get(id)) ?? new Uint8Array(), data.byteLength + offset);
			buffer.set(data, offset);
			data = buffer;
		}
		this.cache.set(id, data);
		await this.store.set(id, data);
		return data.byteLength;
	}

	public setSync(id: number, data: Uint8Array, offset?: number): number {
		if (offset) {
			const buffer = growBuffer(this.getSync(id) ?? new Uint8Array(), data.byteLength + offset);
			buffer.set(data, offset);
			data = buffer;
		}
		this.cache.set(id, data);
		this.async(this.store.set(id, data));
		return data.byteLength;
	}

	public async remove(id: number): Promise<void> {
		this.cache.delete(id);
		await this.store.delete(id);
	}

	public removeSync(id: number): void {
		this.cache.delete(id);
	}

	public commit(): Promise<void> {
		this.store.cache = this.cache;
		return Promise.resolve();
	}

	public commitSync(): void {
		this.store.cache = this.cache;
	}

	public abort(): Promise<void> {
		this.cache.clear();
		return Promise.resolve();
	}

	public abortSync(): void {
		this.cache.clear();
	}
}

interface FetchRemote {
	get(id: number, offset?: number, end?: number): Promise<Uint8Array | undefined>;
	set(id: number, data: Uint8Array, offset?: number): Promise<void>;
	delete(id: number): Promise<void>;
}

export class FetchStore implements Store {
	public readonly flags = ['partial'] as const;

	public constructor(
		protected index: Index,
		protected remote: FetchRemote
	) {}

	/** @internal @hidden */
	cache = new Map<number, Uint8Array | undefined>();

	public readonly name: string = 'fetch';

	public async get(id: number, offset?: number, end?: number): Promise<Uint8Array | undefined> {
		if (this.cache.has(id)) return this.cache.get(id)?.subarray(offset, end);

		const data = await this.remote.get(id, offset, end);

		if (!data) return;

		const inode = this.index.getByID(id);

		if (!inode) {
			this.cache.set(id, data);
			return data;
		}

		const full = new Uint8Array(inode.size);
		full.set(data, offset);
		this.cache.set(id, full);
		return data;
	}

	public async set(id: number, data: Uint8Array, offset?: number): Promise<void> {
		await this.remote.set(id, data, offset);
	}

	public async delete(id: number): Promise<void> {
		await this.remote.delete(id);
	}

	public sync(): Promise<void> {
		return Promise.resolve();
	}

	public clear(): Promise<void> {
		this.cache.clear();
		return Promise.resolve();
	}

	public clearSync(): void {
		this.cache.clear();
	}

	public transaction(): FetchTransaction {
		return new FetchTransaction(this);
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
export class FetchFS extends StoreFS<FetchStore> {
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
		public readonly baseUrl: string = '',
		public readonly requestInit?: RequestInit
	) {
		log_deprecated('FetchFS');
		super(
			new FetchStore(typeof index == 'string' ? new Index() : new Index().fromJSON(index), {
				get: async (id: number) => {
					const { entries } = await this.indexData;
					const path = Object.entries(entries).find(([, node]) => node.data == id)?.[0];
					return fetchFile(this.baseUrl + path, 'buffer', this.requestInit).catch(() => undefined);
				},
				set() {
					throw ErrnoError.With('ENOTSUP');
				},
				delete() {
					throw ErrnoError.With('ENOTSUP');
				},
			})
		);

		// prefix url must end in a directory separator.
		if (baseUrl.at(-1) == '/') this.baseUrl = baseUrl.slice(0, -1);

		this.indexData = typeof index != 'string' ? index : fetchFile<IndexData>(index, 'json', requestInit);
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

		const indexData = typeof options.index != 'string' ? options.index : await fetchFile<IndexData>(options.index, 'json', options.requestInit);
		const index = new Index().fromJSON(indexData);

		const _update = async (method: 'POST' | 'DELETE', id: number, body?: Uint8Array) => {
			if (!options.remoteWrite) return;
			const [path, inode] = [...index].find(([, node]) => node.data == id) || [];
			if (!path || !inode) return;
			await fetch(baseUrl + path, {
				...options.requestInit,
				headers: { ...options.requestInit?.headers, metadata: JSON.stringify(inode.toJSON()) },
				method,
				body,
			});
		};

		const store = new FetchStore(index, {
			async get(id: number) {
				const path = [...index].find(([, node]) => node.data == id)?.[0];
				return !path ? undefined : fetchFile(baseUrl + path, 'buffer', options.requestInit).catch(() => undefined);
			},
			set: (id, body) => _update('POST', id, body),
			delete: id => _update('DELETE', id),
		});

		const fs = new StoreFS(store);
		await fs.loadIndex(index);

		if (options.disableAsyncCache) return fs;

		await using tx = fs.transaction();

		// Iterate over all of the files and cache their contents
		for (const [path, node] of index) {
			if (!(node.mode & S_IFREG)) continue;

			const content = await fetchFile(baseUrl + path, 'buffer', options.requestInit);

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
