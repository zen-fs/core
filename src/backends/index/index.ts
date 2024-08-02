import { isJSON } from 'utilium';
import { Errno, ErrnoError } from '../../error.js';
import type { StatsLike } from '../../stats.js';
import { Stats } from '../../stats.js';
import { encode } from '../../utils.js';
import { basename, dirname } from '../../emulation/path.js';

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
	public constructor() {
		super();
	}

	/**
	 * Convience method
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
				stats.fileData = encode(JSON.stringify(this.dirEntries(path)));
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
