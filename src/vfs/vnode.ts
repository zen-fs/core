// SPDX-License-Identifier: LGPL-3.0-or-later
import { RwLockable } from 'kerium/locks';
import { Resource, type Range } from 'utilium/cache';
import type { FileSystem } from '../internal/filesystem.js';
import { InodeFlags, isBlockDevice, isCharacterDevice, type InodeLike } from '../internal/inode.js';

/**
 * A VFS-level node, roughly equivalent to Linux's in-memory `struct inode`.
 *
 * A `VNode` is the single authoritative copy of an inode's metadata and cached data at the VFS level.
 * All open `Handle`s for the same file share one `VNode`, so metadata changes are immediately visible across handles.
 * File data written through a `VNode` is cached and only written to the backend when the vnode is synced.
 *
 * `VNode` methods do *not* acquire the vnode's lock. Callers are responsible for locking, since operations usually span multiple vnode calls.
 * @category VFS
 */
export class VNode extends RwLockable {
	/** Cached file data. This is a page cache, but with byte granularity */
	public readonly data: Resource<number>;

	/** Ranges of `data` that have been written but not yet synced to the backend */
	protected dirtyRanges: Range[] = [];

	/** The smallest size this vnode has been truncated to since the last sync, if it has been truncated */
	protected truncatedTo?: number;

	/** Whether `inode` has changes that have not been synced to the backend */
	public metadataDirty: boolean = false;

	/** The number of active references: open handles and in-progress VFS operations */
	public refs: number = 0;

	/** Paths on `fs` that refer to this vnode. Multiple paths refer to the same vnode with hard links */
	public readonly paths = new Set<string>();

	/** Fallback for when the last path is removed (i.e. the file is unlinked while open) */
	protected _lastPath: string;

	public constructor(
		public readonly fs: FileSystem,
		path: string,
		public readonly inode: InodeLike
	) {
		super();
		this.paths.add(path);
		this._lastPath = path;
		this.data = new Resource(inode.ino, inode.size, { sparse: true });
	}

	public get ino(): number {
		return this.inode.ino;
	}

	/** A path that can be used to address the backend */
	public get path(): string {
		const [path] = this.paths;
		if (path !== undefined) this._lastPath = path;
		return path ?? this._lastPath;
	}

	/** Whether this vnode has data or metadata that has not been synced to the backend */
	public get dirty(): boolean {
		return this.metadataDirty || this.dirtyRanges.length > 0;
	}

	/** Character and block devices bypass the data cache */
	protected get bypassCache(): boolean {
		return isCharacterDevice(this.inode) || isBlockDevice(this.inode) || !!(this.inode.flags! & InodeFlags.DAX);
	}

	/** Add a range to `dirtyRanges`, merging overlapping and adjacent ranges */
	protected markDirty(start: number, end: number): void {
		this.dirtyRanges.push({ start, end });
		this.dirtyRanges.sort((a, b) => a.start - b.start);
		const merged: Range[] = [];
		for (const range of this.dirtyRanges) {
			const last = merged.at(-1);
			if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
			else merged.push(range);
		}
		this.dirtyRanges = merged;
	}

	/**
	 * Copy `[start, end)` from the cache into `buffer`.
	 * Uncached spans are holes (e.g. from an extending truncate) and are zero-filled.
	 */
	protected copyFromCache(buffer: Uint8Array, start: number, end: number): void {
		let pos = start;
		for (const region of this.data.regions) {
			const regionEnd = region.offset + region.data.byteLength;
			if (regionEnd <= pos) continue;
			if (region.offset >= end) break;

			if (region.offset > pos) {
				buffer.fill(0, pos - start, region.offset - start);
				pos = region.offset;
			}

			const copyEnd = Math.min(end, regionEnd);
			buffer.set(region.data.subarray(pos - region.offset, copyEnd - region.offset), pos - start);
			pos = copyEnd;
		}
		if (pos < end) buffer.fill(0, pos - start, end - start);
	}

	/**
	 * Read `[start, end)` into `buffer`, fetching any missing ranges from the backend.
	 */
	public async read(buffer: Uint8Array, start: number, end: number): Promise<void> {
		if (this.bypassCache) return await this.fs.read(this.path, buffer, start, end);

		for (const { start: rangeStart, end: rangeEnd } of this.data.missing(start, end)) {
			const chunk = new Uint8Array(rangeEnd - rangeStart);
			await this.fs.read(this.path, chunk, rangeStart, rangeEnd);
			this.data.add(chunk, rangeStart);
		}

		this.copyFromCache(buffer, start, end);
	}

	public readSync(buffer: Uint8Array, start: number, end: number): void {
		if (this.bypassCache) return this.fs.readSync(this.path, buffer, start, end);

		for (const { start: rangeStart, end: rangeEnd } of this.data.missing(start, end)) {
			const chunk = new Uint8Array(rangeEnd - rangeStart);
			this.fs.readSync(this.path, chunk, rangeStart, rangeEnd);
			this.data.add(chunk, rangeStart);
		}

		this.copyFromCache(buffer, start, end);
	}

	/**
	 * Write `data` at `offset` into the cache and update metadata.
	 * The backend is not written to until `sync`, except for devices, which bypass the cache.
	 */
	public async write(data: Uint8Array, offset: number): Promise<void> {
		if (this.bypassCache) await this.fs.write(this.path, data, offset);
		else this._writeCached(data, offset);
		this._writeMetadata(offset + data.byteLength);
	}

	public writeSync(data: Uint8Array, offset: number): void {
		if (this.bypassCache) this.fs.writeSync(this.path, data, offset);
		else this._writeCached(data, offset);
		this._writeMetadata(offset + data.byteLength);
	}

	protected _writeCached(data: Uint8Array, offset: number): void {
		const end = offset + data.byteLength;

		// Copy since the region can keep a reference and the caller may reuse the buffer
		this.data.add(data.slice(), offset);

		if (end > this.data.size) this.data.size = end;
		this.markDirty(offset, end);
	}

	protected _writeMetadata(end: number): void {
		if (!this.bypassCache && end > this.inode.size) this.inode.size = end;
		this.inode.mtimeMs = Date.now();
		this.inode.ctimeMs = Date.now();
		this.metadataDirty = true;
	}

	/**
	 * Change the size of the file.
	 * Note an extending truncate creates a hole, which reads as zeroes.
	 */
	public truncate(length: number): void {
		this.truncatedTo = Math.min(this.truncatedTo ?? length, length);
		this.data.size = length;

		this.dirtyRanges = this.dirtyRanges
			.filter(range => range.start < length)
			.map(range => (range.end > length ? { start: range.start, end: length } : range));

		this.inode.size = length;
		this.inode.mtimeMs = Date.now();
		this.inode.ctimeMs = Date.now();
		this.metadataDirty = true;
	}

	/**
	 * Whether the backend has to be told about a truncation before the dirty data is written.
	 */
	protected get needsPreTruncate(): boolean {
		return !this.bypassCache && this.truncatedTo !== undefined && this.truncatedTo < this.inode.size && !this.fs.attributes.has('no_write');
	}

	/** Write all unsynced data to the backend, then metadata */
	public async sync(): Promise<void> {
		if (this.needsPreTruncate) await this.fs.touch(this.path, { size: this.truncatedTo });
		this.truncatedTo = undefined;

		for (const range of this.dirtyRanges) {
			for (let pos = range.start; pos < range.end;) {
				const region = this.data.regionAt(pos);
				if (!region) break; // should not happen since dirty ranges are always cached
				const end = Math.min(range.end, region.offset + region.data.byteLength);
				await this.fs.write(this.path, region.data.subarray(pos - region.offset, end - region.offset), pos);
				pos = end;
			}
		}
		this.dirtyRanges = [];

		if (!this.metadataDirty) return;
		if (!this.fs.attributes.has('no_write')) await this.fs.touch(this.path, this.inode);
		this.metadataDirty = false;
	}

	public syncSync(): void {
		if (this.needsPreTruncate) this.fs.touchSync(this.path, { size: this.truncatedTo });
		this.truncatedTo = undefined;

		for (const range of this.dirtyRanges) {
			for (let pos = range.start; pos < range.end;) {
				const region = this.data.regionAt(pos);
				if (!region) break; // should not happen since dirty ranges are always cached
				const end = Math.min(range.end, region.offset + region.data.byteLength);
				this.fs.writeSync(this.path, region.data.subarray(pos - region.offset, end - region.offset), pos);
				pos = end;
			}
		}
		this.dirtyRanges = [];

		if (!this.metadataDirty) return;
		if (!this.fs.attributes.has('no_write')) this.fs.touchSync(this.path, this.inode);
		this.metadataDirty = false;
	}
}
