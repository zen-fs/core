// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { err, warn } from 'kerium/log';
import { decodeUTF8 } from 'utilium';
import * as requests from 'utilium/requests.js';
import type { IndexData } from '../internal/file_index.js';
import { Index } from '../internal/file_index.js';
import { IndexFS } from '../internal/index_fs.js';
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
	/**
	 * @internal @hidden
	 */
	_asyncDone: Promise<unknown> = Promise.resolve();

	protected _async(p: Promise<unknown>) {
		this._asyncDone = this._asyncDone.then(() => p);
	}

	public constructor(
		index: Index,
		protected baseUrl: string,
		protected requestInit: RequestInit = {},
		protected remoteWrite?: boolean
	) {
		super(0x206e6673, 'nfs', index);
	}

	protected async remove(path: string): Promise<void> {
		await requests.remove(this.baseUrl + path, { warn, cacheOnly: !this.remoteWrite }, this.requestInit);
	}

	protected removeSync(path: string): void {
		this._async(requests.remove(this.baseUrl + path, { warn, cacheOnly: !this.remoteWrite }, this.requestInit));
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
			this._async(requests.get(this.baseUrl + path, { start: offset, end, size: inode.size, warn }));
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

		this._async(requests.set(this.baseUrl + path, data, { offset, warn, cacheOnly: !this.remoteWrite }, this.requestInit).catch(parseError));
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
