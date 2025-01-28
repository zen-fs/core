/* eslint-disable @typescript-eslint/require-await */
import { ErrnoError } from '../../error.js';
import type { PureCreationOptions } from '../../filesystem.js';
import { Stats } from '../../stats.js';
import { join, relative } from '../../vfs/path.js';
import { Index } from './file_index.js';
import { StoreFS } from './fs.js';
import type { Inode } from './inode.js';
import type { Store } from './store.js';

/**
 * Uses an `Index` for metadata.
 *
 * Implementors: You *must* populate the underlying store for read operations to work!
 */
export class IndexFS<T extends Store> extends StoreFS<T> {
	public constructor(
		store: T,
		public readonly index: Index = new Index()
	) {
		super(store);
	}

	/**
	 * @deprecated
	 */
	public reloadFiles(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	/**
	 * @deprecated
	 */
	public reloadFilesSync(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	protected _rename(oldPath: string, newPath: string) {
		if (newPath === oldPath) return;
		const toRename = [];
		for (const [key, inode] of this.index.entries()) {
			const rel = relative(oldPath, key);
			if (rel.startsWith('..')) continue;
			let newKey = join(newPath, rel);
			if (newKey.endsWith('/')) newKey = newKey.slice(0, -1);
			toRename.push({ oldKey: key, newKey, inode });
		}

		for (const { oldKey, newKey, inode } of toRename) {
			this.index.delete(oldKey);
			this.index.set(newKey, inode);
		}
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		await super.rename(oldPath, newPath);
		this._rename(oldPath, newPath);
	}

	public renameSync(oldPath: string, newPath: string): void {
		super.renameSync(oldPath, newPath);
		this._rename(oldPath, newPath);
	}

	public async stat(path: string): Promise<Stats> {
		return this.statSync(path);
	}

	public statSync(path: string): Stats {
		if (!this.index.has(path)) throw ErrnoError.With('ENOENT', path, 'stat');

		return new Stats(this.index.get(path));
	}

	protected async commitNew(path: string, options: PureCreationOptions, data: Uint8Array, syscall: string): Promise<Inode> {
		const node = await super.commitNew(path, options, data, syscall);
		this.index.set(path, node);
		return node;
	}

	protected commitNewSync(path: string, options: PureCreationOptions, data: Uint8Array, syscall: string): Inode {
		const node = super.commitNewSync(path, options, data, syscall);
		this.index.set(path, node);
		return node;
	}

	public async readdir(path: string): Promise<string[]> {
		return Object.keys(this.index.directoryEntries(path));
	}

	public readdirSync(path: string): string[] {
		return Object.keys(this.index.directoryEntries(path));
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
