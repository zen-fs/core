// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { err, warn } from 'kerium/log';
import { _throw, decodeUTF8 } from 'utilium';
import { AsyncQueue } from 'utilium/async-queue';
import { Resource } from 'utilium/cache';
import * as requests from 'utilium/requests';
import type { IndexData } from '../internal/file_index.js';
import { Index } from '../internal/file_index.js';
import { IndexFS } from '../internal/index_fs.js';
import type { Inode, InodeLike } from '../internal/inode.js';
import { isDirectory } from '../internal/inode.js';
import { normalizePath } from '../utils.js';
import { S_IFREG } from '../constants.js';
import type { Backend, SharedConfig } from './backend.js';

/** Parse and throw */
function parseError(error: requests.Issue): never {
	if (!('tag' in error)) throw err(withErrno('EIO', error.stack));

	switch (error.tag) {
		case 'fetch':
			throw err(withErrno('EREMOTEIO', error.message));
		case 'status':
			throw err(withErrno(error.response.status > 500 ? 'EREMOTEIO' : 'EIO', 'Response status code is ' + error.response.status));
		case 'size':
			throw err(withErrno('EBADE', error.message));
		case 'buffer':
			throw err(withErrno('EIO', 'Failed to decode buffer'));
	}
}

/**
 * Configuration options for FetchFS.
 * @category Backends and Configuration
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

	/**
	 * Used as the URL prefix for fetched files.
	 */
	baseUrl: string;

	/**
	 * If true, enables writing to the remote (using post and delete)
	 * @default false
	 */
	remoteWrite?: boolean;
}

/**
 * A simple filesystem backed by HTTP using the `fetch` API.
 * @category Internals
 * @internal
 */
export class FetchFS extends IndexFS {
	/** Changes made by sync methods, whose first failure is thrown by the next `sync` */
	protected readonly changes = new AsyncQueue();

	public constructor(
		index: Index,
		protected baseUrl: string,
		protected requestInit: RequestInit = {},
		protected remoteWrite?: boolean,
	) {
		super(0x206e6673, 'nfs', index);
		this.changes.addEventListener('error', event => {
			const { error } = event as ErrorEvent;
			err('Fetch: deferred update failed: ' + (Error.isError(error) ? error.message : String(error)));
		});
	}

	public async sync(): Promise<void> {
		await this.changes.settled();
		this.changes.throwIfError();
	}

	/** Note this can only report failures of changes that have already finished */
	public syncSync(): void {
		this.changes.throwIfError();
	}

	protected resize(path: string, inode: Inode, oldSize: number): Promise<void> | void {
		if (isDirectory(inode) || inode.size == oldSize) return;

		const url = this.baseUrl + path;
		const resource = requests.resourcesCache.get(url) ?? new Resource(url, oldSize, {}, requests.resourcesCache);

		resource.size = inode.size;
		if (inode.size < oldSize) return;

		const zeroes = new Uint8Array(inode.size - oldSize);
		resource.add(zeroes, oldSize);

		if (this.remoteWrite) return requests.set(url, zeroes, { offset: oldSize, warn }, this.requestInit).catch(parseError);
	}

	protected async _create(path: string, inode: Inode): Promise<void> {
		await requests
			.set(this.baseUrl + path, new Uint8Array(inode.size), { warn, cacheOnly: !this.remoteWrite, method: 'PUT' }, this.requestInit)
			.catch(parseError);
	}

	protected _createSync(path: string, inode: Inode): void {
		this.changes.add(this._create(path, inode));
	}

	public override async touch(path: string, metadata: InodeLike): Promise<void> {
		const inode = this.index.get(path) ?? _throw(withErrno('ENOENT'));
		const oldSize = inode.size;
		inode.update(metadata);
		await this.resize(path, inode, oldSize);
	}

	public override touchSync(path: string, metadata: InodeLike): void {
		const inode = this.index.get(path) ?? _throw(withErrno('ENOENT'));
		const oldSize = inode.size;
		inode.update(metadata);
		const pending = this.resize(path, inode, oldSize);
		if (pending) this.changes.add(pending);
	}

	protected async remove(path: string): Promise<void> {
		await requests.remove(this.baseUrl + path, { warn, cacheOnly: !this.remoteWrite }, this.requestInit);
	}

	protected removeSync(path: string): void {
		this.changes.add(this.remove(path));
	}

	public async read(path: string, buffer: Uint8Array, offset: number = 0, end: number): Promise<void> {
		const inode = this.index.get(path);
		if (!inode) throw withErrno('ENOENT');

		if (end - offset == 0) return;

		const data = await requests
			.get(this.baseUrl + path, { start: offset, end, size: inode.size, warn }, this.requestInit)
			.catch(parseError)
			.catch(() => undefined);

		if (!data) throw withErrno('ENODATA');

		buffer.set(data);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number = 0, end: number): void {
		const inode = this.index.get(path);
		if (!inode) throw withErrno('ENOENT');

		if (end - offset == 0) return;

		const { data, missing } = requests.getCached(this.baseUrl + path, { start: offset, end, size: inode.size, warn });

		if (!data) throw withErrno('ENODATA');

		if (missing.length) {
			void requests
				.get(this.baseUrl + path, { start: offset, end, size: inode.size, warn }, this.requestInit)
				.catch(error => warn('Fetch: background load failed: ' + (Error.isError(error) ? error.message : String(error))));
			throw withErrno('EAGAIN');
		}

		buffer.set(data);
	}

	public async write(path: string, data: Uint8Array, offset: number): Promise<void> {
		const inode = this.index.get(path);
		if (!inode) throw withErrno('ENOENT');

		inode.update({ mtimeMs: Date.now(), size: Math.max(inode.size, data.byteLength + offset) });

		await requests.set(this.baseUrl + path, data, { offset, warn, cacheOnly: !this.remoteWrite }, this.requestInit).catch(parseError);
	}

	public writeSync(path: string, data: Uint8Array, offset: number): void {
		const inode = this.index.get(path);
		if (!inode) throw withErrno('ENOENT');

		inode.update({ mtimeMs: Date.now(), size: Math.max(inode.size, data.byteLength + offset) });

		this.changes.add(requests.set(this.baseUrl + path, data, { offset, warn, cacheOnly: !this.remoteWrite }, this.requestInit).catch(parseError));
	}
}

const _Fetch = {
	name: 'Fetch',

	options: {
		index: { type: ['string', 'object'], required: false },
		baseUrl: { type: 'string', required: true },
		requestInit: { type: 'object', required: false },
		remoteWrite: { type: 'boolean', required: false },
	},

	isAvailable(): boolean {
		return typeof globalThis.fetch == 'function';
	},

	async create(options: FetchOptions) {
		const url = new URL(options.baseUrl);
		url.pathname = normalizePath(url.pathname);
		let baseUrl = url.toString();
		if (baseUrl.at(-1) == '/') baseUrl = baseUrl.slice(0, -1);

		options.index ??= 'index.json';

		const index = new Index();

		if (typeof options.index != 'string') {
			index.fromJSON(options.index);
		} else {
			const data = await requests.get(options.index, { warn }, options.requestInit).catch(parseError);
			index.fromJSON(JSON.parse(decodeUTF8(data)));
		}

		const fs = new FetchFS(index, baseUrl, options.requestInit, options.remoteWrite);

		if (options.disableAsyncCache) return fs;

		// Iterate over all of the files and cache their contents
		for (const [path, node] of index) {
			if (!(node.mode & S_IFREG)) continue;

			await requests.get(baseUrl + path, { warn }, options.requestInit).catch(parseError);
		}

		return fs;
	},
} as const satisfies Backend<FetchFS, FetchOptions>;
type _Fetch = typeof _Fetch;
export interface Fetch extends _Fetch {}
/**
 * @category Backends and Configuration
 */
export const Fetch: Fetch = _Fetch;
