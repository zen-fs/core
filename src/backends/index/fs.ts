import type { Cred } from '../../cred.js';
import { ErrnoError, Errno } from '../../error.js';
import { NoSyncFile, isWriteable, flagToMode } from '../../file.js';
import { FileSystem } from '../../filesystem.js';
import { Readonly } from '../../mixins/readonly.js';
import type { Stats } from '../../stats.js';
import { decode } from '../../utils.js';
import type { IndexData } from './index.js';
import { Index } from './index.js';

export abstract class IndexFS extends Readonly(FileSystem) {
	protected index: Index = new Index();

	protected _isInitialized: boolean = false;

	public async ready(): Promise<void> {
		await super.ready();
		if (this._isInitialized) {
			return;
		}
		this.index.fromJSON(await this.indexData);
		this._isInitialized = true;
	}

	constructor(private indexData: IndexData | Promise<IndexData>) {
		super();
	}

	public async reloadFiles(): Promise<void> {
		for (const [path, stats] of this.index.files()) {
			delete stats.fileData;
			stats.fileData = await this.getData(path, stats);
		}
	}

	public reloadFilesSync(): void {
		for (const [path, stats] of this.index.files()) {
			delete stats.fileData;
			stats.fileData = this.getDataSync(path, stats);
		}
	}

	public stat(path: string): Promise<Stats> {
		return Promise.resolve(this.statSync(path));
	}

	public statSync(path: string): Stats {
		if (!this.index.has(path)) {
			throw ErrnoError.With('ENOENT', path, 'stat');
		}

		return this.index.get(path)!;
	}

	public async openFile(path: string, flag: string, cred: Cred): Promise<NoSyncFile<this>> {
		if (isWriteable(flag)) {
			// You can't write to files on this file system.
			throw new ErrnoError(Errno.EPERM, path);
		}

		// Check if the path exists, and is a file.
		const stats = this.index.get(path);

		if (!stats) {
			throw ErrnoError.With('ENOENT', path, 'openFile');
		}

		if (!stats.hasAccess(flagToMode(flag), cred)) {
			throw ErrnoError.With('EACCES', path, 'openFile');
		}

		return new NoSyncFile(this, path, flag, stats, stats.isDirectory() ? stats.fileData : await this.getData(path, stats));
	}

	public openFileSync(path: string, flag: string, cred: Cred): NoSyncFile<this> {
		if (isWriteable(flag)) {
			// You can't write to files on this file system.
			throw new ErrnoError(Errno.EPERM, path);
		}

		// Check if the path exists, and is a file.
		const stats = this.index.get(path);

		if (!stats) {
			throw ErrnoError.With('ENOENT', path, 'openFile');
		}

		if (!stats.hasAccess(flagToMode(flag), cred)) {
			throw ErrnoError.With('EACCES', path, 'openFile');
		}

		return new NoSyncFile(this, path, flag, stats, stats.isDirectory() ? stats.fileData : this.getDataSync(path, stats));
	}

	public readdir(path: string): Promise<string[]> {
		return Promise.resolve(this.readdirSync(path));
	}

	public readdirSync(path: string): string[] {
		// Check if it exists.
		const stats = this.index.get(path);
		if (!stats) {
			throw ErrnoError.With('ENOENT', path, 'readdir');
		}

		if (!stats.isDirectory()) {
			throw ErrnoError.With('ENOTDIR', path, 'readdir');
		}

		const content: unknown = JSON.parse(decode(stats.fileData));
		if (!Array.isArray(content)) {
			throw ErrnoError.With('ENODATA', path, 'readdir');
		}
		if (!content.every(item => typeof item == 'string')) {
			throw ErrnoError.With('ENODATA', path, 'readdir');
		}
		return content as string[];
	}

	protected abstract getData(path: string, stats: Stats): Promise<Uint8Array>;
	protected abstract getDataSync(path: string, stats: Stats): Uint8Array;
}
