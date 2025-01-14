import { ErrnoError } from '../../error.js';
import type { File } from '../../file.js';
import { PreloadFile } from '../../file.js';
import type { CreationOptions } from '../../filesystem.js';
import { Stats } from '../../stats.js';
import { S_IFREG } from '../../vfs/constants.js';
import type { IndexData } from './file_index.js';
import { Index } from './file_index.js';
import { StoreFS } from './fs.js';
import type { Store } from './store.js';

/**
 * Uses an `Index` for metadata.
 *
 * Implementors: You *must* populate the underlying store for read operations to work!
 * @deprecated
 */
/* node:coverage disable */
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

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		this.index.get(path)?.update(stats);
		await super.sync(path, data, stats);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		this.index.get(path)?.update(stats);
		super.syncSync(path, data, stats);
	}
}
/* node:coverage enable */
