/* Note: this file is named file_index.ts because Typescript has special behavior regarding index.ts which can't be disabled. */

import { isJSON } from 'utilium';
import { basename, dirname } from '../emulation/path.js';
import { Errno, ErrnoError } from '../error.js';
import { NoSyncFile, isWriteable } from '../file.js';
import { FileSystem } from '../filesystem.js';
import { Readonly } from '../mixins/readonly.js';
import type { StatsLike } from '../stats.js';
import { Stats } from '../stats.js';
import { decodeUTF8, encodeUTF8 } from '../utils.js';

/**
 * An Index in JSON form
 * @internal
 */
export interface IndexData {
	version: 1;
	entries: Record<string, StatsLike<number>>;
}

export const version = 1;

/**
 * An index of files
 * @internal
 */
export class Index extends Map<string, Stats> {
	/**
	 * Convenience method
	 */
	public files(): Map<string, Stats> {
		const files = new Map<string, Stats>();
		for (const [path, stats] of this) {
			if (stats.isFile()) {
				files.set(path, stats);
			}
		}
		return files;
	}

	/**
	 * Converts the index to JSON
	 */
	public toJSON(): IndexData {
		return {
			version,
			entries: Object.fromEntries(this),
		};
	}

	/**
	 * Converts the index to a string
	 */
	public toString(): string {
		return JSON.stringify(this.toJSON());
	}

	/**
	 * Returns the files in the directory `dir`.
	 * This is expensive so it is only called once per directory.
	 */
	protected dirEntries(dir: string): string[] {
		const entries = [];
		for (const entry of this.keys()) {
			if (dirname(entry) == dir) {
				entries.push(basename(entry));
			}
		}
		return entries;
	}

	/**
	 * Loads the index from JSON data
	 */
	public fromJSON(json: IndexData): void {
		if (json.version != version) {
			throw new ErrnoError(Errno.EINVAL, 'Index version mismatch');
		}

		this.clear();

		for (const [path, data] of Object.entries(json.entries)) {
			const stats = new Stats(data);
			if (stats.isDirectory()) {
				stats.fileData = encodeUTF8(JSON.stringify(this.dirEntries(path)));
			}
			this.set(path, stats);
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

	public constructor(private indexData: IndexData | Promise<IndexData>) {
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

	public async openFile(path: string, flag: string): Promise<NoSyncFile<this>> {
		if (isWriteable(flag)) {
			// You can't write to files on this file system.
			throw new ErrnoError(Errno.EPERM, path);
		}

		// Check if the path exists, and is a file.
		const stats = this.index.get(path);

		if (!stats) {
			throw ErrnoError.With('ENOENT', path, 'openFile');
		}

		return new NoSyncFile(this, path, flag, stats, stats.isDirectory() ? stats.fileData : await this.getData(path, stats));
	}

	public openFileSync(path: string, flag: string): NoSyncFile<this> {
		if (isWriteable(flag)) {
			// You can't write to files on this file system.
			throw new ErrnoError(Errno.EPERM, path);
		}

		// Check if the path exists, and is a file.
		const stats = this.index.get(path);

		if (!stats) {
			throw ErrnoError.With('ENOENT', path, 'openFile');
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

		const content: unknown = JSON.parse(decodeUTF8(stats.fileData));
		if (!Array.isArray(content)) {
			throw ErrnoError.With('ENODATA', path, 'readdir');
		}
		if (!content.every(item => typeof item == 'string')) {
			throw ErrnoError.With('ENODATA', path, 'readdir');
		}
		return content;
	}

	protected abstract getData(path: string, stats: Stats): Promise<Uint8Array>;
	protected abstract getDataSync(path: string, stats: Stats): Uint8Array;
}
