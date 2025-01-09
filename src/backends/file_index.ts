/* Note: this file is named file_index.ts because Typescript has special behavior regarding index.ts which can't be disabled. */

import { isJSON, randomInt } from 'utilium';
import { Errno, ErrnoError } from '../error.js';
import type { File } from '../file.js';
import { PreloadFile } from '../file.js';
import type { CreationOptions } from '../filesystem.js';
import { Stats } from '../stats.js';
import { S_IFDIR, S_IFMT, S_IFREG, size_max } from '../vfs/constants.js';
import { basename, dirname } from '../vfs/path.js';
import { StoreFS } from './store/fs.js';
import type { InodeLike } from './store/inode.js';
import { Inode } from './store/inode.js';
import type { Store } from './store/store.js';

/**
 * An Index in JSON form
 * @internal
 */
export interface IndexData {
	version: number;
	entries: Record<string, InodeLike>;
}

export const version = 1;

/**
 * An index of files
 * @internal
 */
export class Index extends Map<string, Readonly<Inode>> {
	public readonly directories = new Map<string, string[]>();

	/**
	 * Converts the index to JSON
	 */
	public toJSON(): IndexData {
		return {
			version,
			entries: Object.fromEntries([...this].map(([k, v]) => [k, v.toJSON()])),
		};
	}

	/**
	 * Converts the index to a string
	 */
	public toString(): string {
		return JSON.stringify(this.toJSON());
	}

	/**
	 * Loads the index from JSON data
	 */
	public fromJSON(json: IndexData): void {
		if (json.version != version) {
			throw new ErrnoError(Errno.EINVAL, 'Index version mismatch');
		}

		this.clear();

		for (const [path, node] of Object.entries(json.entries)) {
			node.data ??= randomInt(1, size_max);

			if (path == '/') node.ino = 0;

			this.set(path, new Inode(node));

			if ((node.mode & S_IFMT) != S_IFDIR) continue;

			const entries = [];
			for (const entry of this.keys()) {
				if (dirname(entry) == path) entries.push(basename(entry));
			}

			this.directories.set(path, entries);
		}
	}

	/**
	 * Parses an index from a string
	 */
	public static parse(data: string): Index {
		if (!isJSON(data)) {
			throw new ErrnoError(Errno.EINVAL, 'Invalid JSON');
		}

		const json = JSON.parse(data) as IndexData;
		const index = new Index();
		index.fromJSON(json);
		return index;
	}
}

/**
 * Uses an `Index` for metadata.
 *
 * Implementors: You *must* populate the underlying store for read operations to work!
 */
export abstract class IndexFS<T extends Store> extends StoreFS<T> {
	protected readonly index: Index = new Index();

	protected _isInitialized: boolean = false;

	public async ready(): Promise<void> {
		await super.ready();
		if (this._isInitialized) return;

		this.index.fromJSON(await this.indexData);
		this._isInitialized = true;
	}

	public constructor(
		store: T,
		private indexData: IndexData | Promise<IndexData>
	) {
		super(store);
	}

	/**
	 * @deprecated
	 */
	public async reloadFiles(): Promise<void> {}

	/**
	 * @deprecated
	 */
	public reloadFilesSync(): void {}

	public stat(path: string): Promise<Stats> {
		return Promise.resolve(this.statSync(path));
	}

	public statSync(path: string): Stats {
		if (!this.index.has(path)) throw ErrnoError.With('ENOENT', path, 'stat');

		return new Stats(this.index.get(path));
	}

	public override async createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File> {
		const node = await this.commitNew(path, S_IFREG, { mode, ...options }, new Uint8Array(), 'createFile');
		const file = new PreloadFile(this, path, flag, node.toStats(), new Uint8Array());
		this.index.set(path, node);
		return file;
	}

	public createFileSync(path: string, flag: string, mode: number, options: CreationOptions): File {
		const node = this.commitNewSync(path, S_IFREG, { mode, ...options }, new Uint8Array(), 'createFile');
		const file = new PreloadFile(this, path, flag, node.toStats(), new Uint8Array());
		this.index.set(path, node);
		return file;
	}

	public async mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
		await super.mkdir(path, mode, options);
		this.index.directories.set(path, []);
	}

	public mkdirSync(path: string, mode: number, options: CreationOptions): void {
		super.mkdirSync(path, mode, options);
		this.index.directories.set(path, []);
	}

	public readdir(path: string): Promise<string[]> {
		return Promise.resolve(this.readdirSync(path));
	}

	public readdirSync(path: string): string[] {
		if (!this.index.has(path)) throw ErrnoError.With('ENOENT', path, 'readdir');

		const data = this.index.directories.get(path);

		if (!data) throw ErrnoError.With('ENOTDIR', path, 'readdir');

		return data;
	}

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		this.index.get(path)?.update(stats);
		await super.sync(path, data, stats);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		this.index.get(path)?.update(stats);
		super.syncSync(path, data, stats);
	}
}
