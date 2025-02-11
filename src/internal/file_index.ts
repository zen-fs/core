/* Note: this file is named file_index.ts because Typescript has special behavior regarding index.ts which can't be disabled. */

import { isJSON, randomInt, sizeof } from 'utilium';
import { S_IFDIR, S_IFMT, size_max } from '../vfs/constants.js';
import { basename, dirname } from '../vfs/path.js';
import { Errno, ErrnoError } from './error.js';
import type { InodeLike } from './inode.js';
import { __inode_sz, Inode } from './inode.js';
import type { UsageInfo } from './filesystem.js';

/**
 * An Index in JSON form
 * @internal
 */
export interface IndexData {
	version: number;
	maxSize?: number;
	entries: Record<string, InodeLike>;
}

export const version = 1;

/**
 * An index of file metadata
 * @category Internals
 * @internal
 */
export class Index extends Map<string, Inode> {
	public maxSize: number = size_max;

	/**
	 * Converts the index to JSON
	 */
	public toJSON(): IndexData {
		return {
			version,
			maxSize: this.maxSize,
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
	 * Get the size in bytes of the index (including the size reported for each entry)
	 */
	public get byteSize(): number {
		let size = this.size * __inode_sz;
		for (const entry of this.values()) size += entry.size;
		return size;
	}

	public usage(): UsageInfo {
		return {
			totalSpace: this.maxSize,
			freeSpace: this.maxSize - this.byteSize,
		};
	}

	public pathOf(id: number): string | undefined {
		for (const [path, inode] of this) {
			if (inode.ino == id || inode.data == id) return path;
		}
	}

	public getByID(id: number): Inode | undefined {
		return this.entryByID(id)?.inode;
	}

	public entryByID(id: number): { path: string; inode: Inode } | undefined {
		for (const [path, inode] of this) {
			if (inode.ino == id || inode.data == id) return { path, inode };
		}
	}

	public directoryEntries(path: string): Record<string, number> {
		const node = this.get(path);

		if (!node) throw ErrnoError.With('ENOENT', path);

		if ((node.mode & S_IFMT) != S_IFDIR) throw ErrnoError.With('ENOTDIR', path);

		const entries: Record<string, number> = {};

		for (const entry of this.keys()) {
			if (dirname(entry) == path && entry != path) {
				entries[basename(entry)] = this.get(entry)!.ino;
			}
		}

		return entries;
	}

	/**
	 * Get the next available ID in the index
	 * @internal
	 */
	_alloc(): number {
		return Math.max(...[...this.values()].flatMap(i => [i.ino, i.data])) + 1;
	}

	/**
	 * Gets a list of entries for each directory in the index.
	 * Use
	 */
	public directories(): Map<string, Record<string, number>> {
		const dirs = new Map<string, Record<string, number>>();
		for (const [path, node] of this) {
			if ((node.mode & S_IFMT) != S_IFDIR) continue;

			const entries: Record<string, number> = {};

			for (const entry of this.keys()) {
				if (dirname(entry) == path && entry != path) entries[basename(entry)] = this.get(entry)!.ino;
			}

			dirs.set(path, entries);
		}

		return dirs;
	}

	/**
	 * Loads the index from JSON data
	 */
	public fromJSON(json: IndexData): this {
		if (json.version != version) {
			throw new ErrnoError(Errno.EINVAL, 'Index version mismatch');
		}

		this.clear();

		for (const [path, node] of Object.entries(json.entries)) {
			node.data ??= randomInt(1, size_max);

			if (path == '/') node.ino = 0;

			this.set(path, new Inode(node));
		}

		return this;
	}

	/**
	 * Parses an index from a string
	 */
	public static parse(data: string): Index {
		if (!isJSON(data)) throw new ErrnoError(Errno.EINVAL, 'Invalid JSON');

		const json = JSON.parse(data) as IndexData;
		const index = new Index();
		index.fromJSON(json);
		return index;
	}
}
