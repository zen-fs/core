// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { sizeof } from 'memium';
import { isJSON, randomInt } from 'utilium';
import '../polyfills.js';
import { basename, dirname, join } from '../path.js';
import { S_IFDIR, S_IFMT, size_max } from '../constants.js';
import type { UsageInfo } from './filesystem.js';
import type { InodeJSON } from './inode.js';
import { Inode } from './inode.js';

/**
 * An Index in JSON form
 * @internal
 */
export interface IndexData {
	version: number;
	maxSize?: number;
	entries: Record<string, InodeJSON>;
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
			// @todo use `Iterator.map` #296
			entries: Object.fromEntries(Array.from(this).map(([k, v]) => [k, v.toJSON()])),
		};
	}

	/**
	 * Converts the index to a string
	 */
	public toString(): string {
		return JSON.stringify(this.toJSON());
	}

	/** The names in each directory, by the directory's path */
	#children = new Map<string, Set<string>>();

	public set(path: string, inode: Inode): this {
		if (path != '/' && !this.has(path)) this.#children.getOrInsertComputed(dirname(path), () => new Set()).add(basename(path));
		return super.set(path, inode);
	}

	public delete(path: string): boolean {
		if (!super.delete(path)) return false;
		if (path == '/') return true;
		const parent = dirname(path);
		const names = this.#children.get(parent);
		names?.delete(basename(path));
		if (!names?.size) this.#children.delete(parent);
		return true;
	}

	public clear() {
		super.clear();
		this.#children.clear();
		this.#lastAlloc = 0n;
	}

	/**
	 * Get the size in bytes of the index (including the size reported for each entry)
	 */
	public get byteSize(): number {
		let size = this.size * sizeof(Inode);
		for (const entry of this.values()) size += entry.size;
		return size;
	}

	public usage(): UsageInfo {
		return {
			totalSpace: this.maxSize,
			freeSpace: this.maxSize - this.byteSize,
		};
	}

	public pathOf(id: bigint): string | undefined {
		for (const [path, inode] of this) {
			if (inode.ino == id || inode.data == id) return path;
		}
	}

	public getByID(id: bigint): Inode | undefined {
		return this.entryByID(id)?.inode;
	}

	public entryByID(id: bigint): { path: string; inode: Inode } | undefined {
		for (const [path, inode] of this) {
			if (inode.ino == id || inode.data == id) return { path, inode };
		}
	}

	public directoryEntries(path: string): Record<string, bigint> {
		const node = this.get(path);

		if (!node) throw withErrno('ENOENT');

		if ((node.mode & S_IFMT) != S_IFDIR) throw withErrno('ENOTDIR');

		return this.#entriesOf(path);
	}

	#entriesOf(path: string): Record<string, bigint> {
		const entries: Record<string, bigint> = {};
		for (const name of this.#children.get(path) ?? []) {
			entries[name] = this.get(join(path, name))!.ino;
		}
		return entries;
	}

	#lastAlloc = 0n;

	/**
	 * Get the next available ID in the index
	 * @internal
	 */
	_alloc(): bigint {
		// @todo use `Iterator.flatMap` #296
		const _max = (a: bigint, b: bigint) => (a > b ? a : b);
		this.#lastAlloc ||= Array.from(this.values()).reduce((max, { ino, data }) => _max(max, _max(ino, data)), 0n);
		this.#lastAlloc++;
		return this.#lastAlloc++;
	}

	/**
	 * Gets a list of entries for each directory in the index.
	 * Use
	 */
	public directories(): Map<string, Record<string, bigint>> {
		const dirs = new Map<string, Record<string, bigint>>();
		for (const [path, node] of this) {
			if ((node.mode & S_IFMT) == S_IFDIR) dirs.set(path, this.#entriesOf(path));
		}

		return dirs;
	}

	/**
	 * Loads the index from JSON data
	 */
	public fromJSON(json: IndexData): this {
		if (json.version != version) throw withErrno('EINVAL', 'Index version mismatch');

		this.clear();

		for (const [path, node] of Object.entries(json.entries)) {
			this.set(path, Inode.fromJSON({ ...node, ino: path == '/' ? 0 : node.ino, data: node.data ?? randomInt(1, size_max) }));
		}

		return this;
	}

	/**
	 * Parses an index from a string
	 */
	public static parse(data: string): Index {
		if (!isJSON(data)) throw withErrno('EINVAL', 'Invalid JSON');

		const json = JSON.parse(data) as IndexData;
		const index = new Index();
		index.fromJSON(json);
		return index;
	}
}
