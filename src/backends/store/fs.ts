// SPDX-License-Identifier: LGPL-3.0-or-later
import { withErrno } from 'kerium';
import { crit, debug, err, notice, warn } from 'kerium/log';
import { sizeof, struct, types as t } from 'memium';
import { _throw, canary, decodeUTF8, encodeUTF8 } from 'utilium';
import { extendBuffer } from 'utilium/buffer';
import { id_max, S_IFDIR, S_IFREG } from '../../constants.js';
import { Index } from '../../internal/file_index.js';
import type { CreationOptions, UsageInfo } from '../../internal/filesystem.js';
import { FileSystem } from '../../internal/filesystem.js';
import { Inode, isDirectory, isFile, rootIno, type InodeLike } from '../../internal/inode.js';
import { basename, dirname, join, parse, relative } from '../../path.js';
import { DirType, ifToDt } from '../../vfs/dir.js';
import { WrappedTransaction, type Store } from './store.js';

const DirEntry = struct.packed(
	'DirEntry',
	{
		id: t.uint64,
		type: t.uint8.$type<DirType>(),
		name_length: t.uint16,
		name: t.uint8(0).countedBy('name_length'),
	},
	{ isDynamic: true, fastFields: true },
);
type DirEntry = InstanceType<typeof DirEntry>;

const nameLengthOffset = DirEntry.fields.find(field => field.name == 'name_length')!.offset;

interface DirEntryInit {
	name: string;
	id: bigint;
	type: DirType;
}

function encodeName(name: string): Uint8Array {
	const encoded = encodeUTF8(name);
	if (encoded.length > 0xffff) throw withErrno('ENAMETOOLONG');
	return encoded;
}

/** Writes an entry at `offset` and returns its size in bytes */
function writeEntry(buffer: ArrayBufferLike, offset: number, name: Uint8Array, id: bigint, type: DirType): number {
	const entry = new DirEntry(buffer, offset);
	entry.id = id;
	entry.type = type;
	entry.name_length = name.length;
	new Uint8Array(buffer, offset + sizeof(DirEntry), name.length).set(name);
	return sizeof(DirEntry) + name.length;
}

const dirListingMagic = 0xd1;

/** The first byte of a directory listing written as JSON by older versions, '{' */
const legacyListingMagic = 0x7b;

/**
 * A directory listing, followed by `entry_count` variable-length `DirEntry`s.
 * Listings are immutable, so they can be backed by store memory; changes return a new listing. (RCU)
 */
class DirListing
	extends struct.packed('DirListing', { magic: t.uint8, entry_count: t.uint32 }, { fastFields: true })
	implements ReadonlyMap<string, DirEntry>
{
	/**
	 * Yields the offset and name length of each entry.
	 * This reads the bytes directly, since struct field access costs too much per entry.
	 */
	protected *scan(): Generator<[offset: number, nameLength: number]> {
		const bytes = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
		let offset = sizeof(DirListing);
		for (let i = 0; i < this.entry_count; i++) {
			const nameLength = bytes[offset + nameLengthOffset] | (bytes[offset + nameLengthOffset + 1] << 8);
			yield [offset, nameLength];
			offset += sizeof(DirEntry) + nameLength;
		}
	}

	protected nameAt(offset: number, nameLength: number): Uint8Array {
		return new Uint8Array(this.buffer, this.byteOffset + offset + sizeof(DirEntry), nameLength);
	}

	public get size(): number {
		return this.entry_count;
	}

	public *entries(): MapIterator<[string, DirEntry]> {
		for (const [offset, nameLength] of this.scan()) {
			yield [decodeUTF8(this.nameAt(offset, nameLength)), new DirEntry(this.buffer, this.byteOffset + offset)];
		}
	}

	public *keys(): MapIterator<string> {
		for (const [offset, nameLength] of this.scan()) yield decodeUTF8(this.nameAt(offset, nameLength));
	}

	public *values(): MapIterator<DirEntry> {
		for (const [offset] of this.scan()) yield new DirEntry(this.buffer, this.byteOffset + offset);
	}

	public [Symbol.iterator](): MapIterator<[string, DirEntry]> {
		return this.entries();
	}

	public forEach(callback: (entry: DirEntry, name: string, listing: this) => void, thisArg?: unknown): void {
		for (const [name, entry] of this) callback.call(thisArg, entry, name, this);
	}

	public get(name: string): DirEntry | undefined {
		const encoded = encodeUTF8(name);
		for (const [offset, nameLength] of this.scan()) {
			if (nameLength != encoded.length) continue;
			const entryName = this.nameAt(offset, nameLength);
			if (entryName.every((byte, i) => byte == encoded[i])) return new DirEntry(this.buffer, this.byteOffset + offset);
		}
	}

	public has(name: string): boolean {
		return !!this.get(name);
	}

	/** Returns a listing with `name` added, replacing any existing entry with that name */
	public with(name: string, id: bigint, type: DirType): DirListing {
		const base = this.without(name);
		const encoded = encodeName(name);

		const data = new Uint8Array(base.byteLength + sizeof(DirEntry) + encoded.length);
		data.set(new Uint8Array(base.buffer, base.byteOffset, base.byteLength));

		const listing = new DirListing(data.buffer);
		listing.entry_count++;
		writeEntry(data.buffer, base.byteLength, encoded, id, type);
		return listing;
	}

	/** Returns a listing without the entry for `name` */
	public without(name: string): DirListing {
		const entry = this.get(name);
		if (!entry) return this;

		const start = entry.byteOffset - this.byteOffset;
		const size = sizeof(DirEntry) + entry.name_length;
		const source = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);

		const data = new Uint8Array(this.byteLength - size);
		data.set(source.subarray(0, start));
		data.set(source.subarray(start + size), start);

		const listing = new DirListing(data.buffer);
		listing.entry_count--;
		return listing;
	}

	/** Creates a listing from entries with unique names */
	public static from(entries: Iterable<DirEntryInit>): DirListing {
		const encoded = Array.from(entries, entry => ({ ...entry, name: encodeName(entry.name) }));

		let size = sizeof(DirListing);
		for (const { name } of encoded) size += sizeof(DirEntry) + name.length;

		const listing = new DirListing(new ArrayBuffer(size));
		listing.magic = dirListingMagic;
		listing.entry_count = encoded.length;

		let offset = sizeof(DirListing);
		for (const { name, id, type } of encoded) offset += writeEntry(listing.buffer, offset, name, id, type);

		return listing;
	}

	/**
	 * Reads a listing from store data, including JSON listings written by older versions.
	 * Entries of JSON listings have an unknown type.
	 */
	public static decode(data: Uint8Array): DirListing {
		if (data[0] == dirListingMagic) return new DirListing(data.buffer, data.byteOffset, data.byteLength);

		if (data[0] != legacyListingMagic) throw crit(withErrno('EIO', 'Invalid directory listing'));

		const legacy = JSON.parse(decodeUTF8(data)) as Record<string, number | string>;
		return DirListing.from(Object.entries(legacy).map(([name, id]) => ({ name, id: BigInt(id), type: DirType.UNKNOWN })));
	}

	/** Whether `data` is a listing in the JSON format written by older versions */
	public static isLegacy(data: Uint8Array): boolean {
		return data[0] == legacyListingMagic;
	}

	/** Creates the listing for the directory at `path` from `Index.directories` entries */
	public static fromIndex(index: Index, path: string, entries: Record<string, bigint>): DirListing {
		return DirListing.from(Object.entries(entries).map(([name, id]) => ({ name, id, type: ifToDt(index.get(join(path, name))!.mode) })));
	}
}

/** Most times a method is run before giving up when other threads keep changing what it read */
const maxAttempts = 100;

/** Runs a method again when committing to an atomic store fails because another thread changed what the method read */
function retry<This extends StoreFS, Args extends unknown[], Result>(
	method: (this: This, ...args: Args) => Result,
	_: ClassMethodDecoratorContext<This>,
) {
	return function (this: This, ...args: Args): Result {
		const conflict = (e: unknown, attempt: number): boolean =>
			attempt < maxAttempts && (e as { code?: string }).code == 'EAGAIN' && !!this['store'].flags?.includes('atomic');

		const run = (attempt: number): Result => {
			let result: Result;
			try {
				result = method.apply(this, args);
			} catch (e) {
				if (conflict(e, attempt)) return run(attempt + 1);
				throw e;
			}
			if (!(result instanceof Promise)) return result;
			return result.catch((e: unknown) => {
				if (conflict(e, attempt)) return run(attempt + 1);
				throw e;
			}) as Result;
		};

		return run(1);
	};
}

/**
 * A file system which uses a `Store`
 *
 * @todo Check modes?
 * @category Stores and Transactions
 * @internal
 */
export class StoreFS<T extends Store = Store> extends FileSystem {
	/**
	 * A map of paths to inode IDs
	 * @internal @hidden
	 */
	readonly _ids = new Map<string, bigint>([['/', rootIno]]);

	/**
	 * A map of inode IDs to paths
	 * @internal @hidden
	 */
	readonly _paths = new Map<bigint, Set<string>>([[rootIno, new Set('/')]]);

	/**
	 * Gets the first path associated with an inode
	 */
	_path(id: bigint): string | undefined {
		const [path] = this._paths.get(id) ?? [];
		return path;
	}

	/**
	 * Add a inode/path pair
	 */
	_add(ino: bigint, path: string) {
		this._paths.getOrInsertComputed(ino, () => new Set()).add(path);
		this._ids.set(path, ino);
	}

	/**
	 * Remove a inode/path pair
	 */
	_remove(ino: bigint) {
		for (const path of this._paths.get(ino) ?? []) {
			this._ids.delete(path);
		}
		this._paths.delete(ino);
	}

	/**
	 * Move paths in the tables
	 */
	_move(from: string, to: string) {
		const toMove = [];
		for (const [path, ino] of this._ids) {
			const rel = relative(from, path);
			if (rel.startsWith('..')) continue;
			let newKey = join(to, rel);
			if (newKey.endsWith('/')) newKey = newKey.slice(0, -1);
			toMove.push({ oldKey: path, newKey, ino });
		}

		for (const { oldKey, newKey, ino } of toMove) {
			this._ids.delete(oldKey);
			this._ids.set(newKey, ino);
			const p = this._paths.get(ino);
			if (!p) {
				warn('Missing paths in table for ino ' + ino);
				continue;
			}
			p.delete(oldKey);
			p.add(newKey);
		}
	}

	protected _initialized: boolean = false;

	public async ready(): Promise<void> {
		if (this._initialized) return;

		if (!this.attributes.has('no_async_preload')) {
			this.checkRootSync();
		}

		await this.checkRoot();
		await this._populate();
		this._initialized = true;
	}

	public readySync(): void {
		if (this._initialized) return;

		if (!this.attributes.has('no_async_preload')) {
			this.checkRootSync();
		}

		this.checkRootSync();
		this._populateSync();
		this._initialized = true;
	}

	public constructor(protected readonly store: T) {
		super(store.type ?? 0x6b766673, store.name);
		store.fs = this;
		this._uuid = store.uuid ?? this.uuid;
		this.label = store.label;
		debug(this.name + ': supports features: ' + this.store.flags?.join(', '));
	}

	public usage(): UsageInfo {
		return (
			this.store.usage?.() || {
				totalSpace: 0,
				freeSpace: 0,
			}
		);
	}

	/**
	 * Load an index into the StoreFS.
	 * You *must* manually add non-directory files
	 */
	public async loadIndex(index: Index): Promise<void> {
		await using tx = this.transaction();

		const dirs = index.directories();

		for (const [path, inode] of index) {
			this._add(inode.ino, path);
			await tx.set(inode.ino, inode);
			if (dirs.has(path)) await tx.set(inode.data, DirListing.fromIndex(index, path, dirs.get(path)!));
		}

		await tx.commit();
	}

	/**
	 * Load an index into the StoreFS.
	 * You *must* manually add non-directory files
	 */
	public loadIndexSync(index: Index): void {
		using tx = this.transaction();

		const dirs = index.directories();

		for (const [path, inode] of index) {
			this._add(inode.ino, path);
			tx.setSync(inode.ino, inode);
			if (dirs.has(path)) tx.setSync(inode.data, DirListing.fromIndex(index, path, dirs.get(path)!));
		}

		tx.commitSync();
	}

	public async createIndex(): Promise<Index> {
		const index = new Index();

		await using tx = this.transaction();

		const queue: [path: string, ino: bigint][] = [['/', rootIno]];

		const silence = canary(withErrno('EDEADLK'));
		while (queue.length) {
			const [path, ino] = queue.shift()!;

			const inode = new Inode(await tx.get(ino));

			index.set(path, inode);

			if (isDirectory(inode)) {
				const dir = DirListing.decode((await tx.get(inode.data)) ?? _throw(withErrno('ENODATA')));

				for (const [name, entry] of dir) {
					queue.push([join(path, name), entry.id]);
				}
			}
		}
		silence();

		return index;
	}

	public createIndexSync(): Index {
		const index = new Index();

		using tx = this.transaction();

		const queue: [path: string, ino: bigint][] = [['/', rootIno]];

		const silence = canary(withErrno('EDEADLK'));
		while (queue.length) {
			const [path, ino] = queue.shift()!;

			const inode = new Inode(tx.getSync(ino));

			index.set(path, inode);

			if (isDirectory(inode)) {
				const dir = DirListing.decode(tx.getSync(inode.data) ?? _throw(withErrno('ENODATA')));

				for (const [name, entry] of dir) {
					queue.push([join(path, name), entry.id]);
				}
			}
		}
		silence();

		return index;
	}

	/**
	 * @todo Make rename compatible with the cache.
	 */
	@retry
	public async rename(oldPath: string, newPath: string): Promise<void> {
		await using tx = this.transaction();
		const _old = parse(oldPath),
			_new = parse(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = await this.findInode(tx, _old.dir),
			oldListing = DirListing.decode((await tx.get(oldDirNode.data)) ?? _throw(withErrno('ENODATA'))),
			entry = oldListing.get(_old.base);

		if (!entry) throw withErrno('ENOENT');

		const ino = entry.id,
			type = entry.type;

		if (ino != this._ids.get(oldPath)) err(`Ino mismatch while renaming ${oldPath} to ${newPath}`);

		const oldDirList = oldListing.without(_old.base);

		/*
			Can't move a folder inside itself.
			This ensures that the check passes only if `oldPath` is a subpath of `_new.dir`.
			We append '/' to avoid matching folders that are a substring of the bottom-most folder in the path.
		*/
		if ((_new.dir + '/').startsWith(oldPath + '/')) throw withErrno('EBUSY');

		const sameParent = _new.dir == _old.dir;

		// Prevent us from re-grabbing the same directory listing, which still contains `old_path.base.`
		const newDirNode: Inode = sameParent ? oldDirNode : await this.findInode(tx, _new.dir);
		const newDirList = sameParent ? oldDirList : DirListing.decode((await tx.get(newDirNode.data)) ?? _throw(withErrno('ENODATA')));

		const existingEntry = newDirList.get(_new.base);
		const existingIno = existingEntry?.id;
		const updated = newDirList.with(_new.base, ino, type);

		if (existingIno !== undefined) {
			const existing = new Inode((await tx.get(existingIno)) ?? _throw(withErrno('ENOENT')));
			if (!isFile(existing)) throw withErrno('EISDIR');

			await tx.remove(existing.data);
			await tx.remove(existingIno);
		}

		if (!sameParent) await tx.set(oldDirNode.data, oldDirList);
		await tx.set(newDirNode.data, updated);
		await tx.commit();
		this._move(oldPath, newPath);
	}

	@retry
	public renameSync(oldPath: string, newPath: string): void {
		using tx = this.transaction();
		const _old = parse(oldPath),
			_new = parse(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = this.findInodeSync(tx, _old.dir),
			oldListing = DirListing.decode(tx.getSync(oldDirNode.data) ?? _throw(withErrno('ENODATA'))),
			entry = oldListing.get(_old.base);

		if (!entry) throw withErrno('ENOENT');

		const ino = entry.id,
			type = entry.type;

		if (ino != this._ids.get(oldPath)) err(`Ino mismatch while renaming ${oldPath} to ${newPath}`);

		const oldDirList = oldListing.without(_old.base);

		/* 
			Can't move a folder inside itself.
			This ensures that the check passes only if `oldPath` is a subpath of `_new.dir`.
			We append '/' to avoid matching folders that are a substring of the bottom-most folder in the path.
		*/
		if ((_new.dir + '/').startsWith(oldPath + '/')) throw withErrno('EBUSY');

		// Add newPath to parent's directory listing.
		const sameParent = _new.dir === _old.dir;

		// Prevent us from re-grabbing the same directory listing, which still contains `old_path.base.`
		const newDirNode: Inode = sameParent ? oldDirNode : this.findInodeSync(tx, _new.dir);
		const newDirList = sameParent ? oldDirList : DirListing.decode(tx.getSync(newDirNode.data) ?? _throw(withErrno('ENODATA')));

		const existingEntry = newDirList.get(_new.base);
		const existingIno = existingEntry?.id;
		const updated = newDirList.with(_new.base, ino, type);

		if (existingIno !== undefined) {
			const existing = new Inode(tx.getSync(existingIno) ?? _throw(withErrno('ENOENT')));
			if (!isFile(existing)) throw withErrno('EISDIR');

			tx.removeSync(existing.data);
			tx.removeSync(existingIno);
		}

		if (!sameParent) tx.setSync(oldDirNode.data, oldDirList);
		tx.setSync(newDirNode.data, updated);
		tx.commitSync();
		this._move(oldPath, newPath);
	}

	public async stat(path: string): Promise<Inode> {
		await using tx = this.transaction();
		return await this.findInode(tx, path);
	}

	public statSync(path: string): Inode {
		using tx = this.transaction();
		return this.findInodeSync(tx, path);
	}

	@retry
	public async touch(path: string, metadata: Partial<InodeLike>): Promise<void> {
		await using tx = this.transaction();
		const inode = await this.findInode(tx, path);

		if (!isDirectory(inode) && metadata.size !== undefined && metadata.size !== inode.size) {
			const data = (await tx.get(inode.data)) ?? new Uint8Array();
			if (metadata.size < data.byteLength) data.fill(0, metadata.size);
			await tx.set(inode.data, metadata.size < data.byteLength ? data.subarray(0, metadata.size) : extendBuffer(data, metadata.size));
		}

		if (inode.update(metadata)) {
			this._add(inode.ino, path);
			tx.setSync(inode.ino, inode);
		}

		await tx.commit();
	}

	@retry
	public touchSync(path: string, metadata: Partial<InodeLike>): void {
		using tx = this.transaction();

		const inode = this.findInodeSync(tx, path);

		if (!isDirectory(inode) && metadata.size !== undefined && metadata.size !== inode.size) {
			const data = tx.getSync(inode.data) ?? new Uint8Array();
			if (metadata.size < data.byteLength) data.fill(0, metadata.size);
			tx.setSync(inode.data, metadata.size < data.byteLength ? data.subarray(0, metadata.size) : extendBuffer(data, metadata.size));
		}

		if (inode.update(metadata)) {
			this._add(inode.ino, path);
			tx.setSync(inode.ino, inode);
		}

		tx.commitSync();
	}

	public async createFile(path: string, options: CreationOptions): Promise<Inode> {
		return await this.commitNew(path, { ...options, mode: options.mode | S_IFREG }, new Uint8Array());
	}

	public createFileSync(path: string, options: CreationOptions): Inode {
		return this.commitNewSync(path, { ...options, mode: options.mode | S_IFREG }, new Uint8Array());
	}

	public async unlink(path: string): Promise<void> {
		return this.remove(path, false);
	}

	public unlinkSync(path: string): void {
		this.removeSync(path, false);
	}

	public async rmdir(path: string): Promise<void> {
		await this.remove(path, true);
	}

	public rmdirSync(path: string): void {
		this.removeSync(path, true);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<Inode> {
		return await this.commitNew(path, { ...options, mode: options.mode | S_IFDIR }, DirListing.from([]));
	}

	public mkdirSync(path: string, options: CreationOptions): Inode {
		return this.commitNewSync(path, { ...options, mode: options.mode | S_IFDIR }, DirListing.from([]));
	}

	public async readdir(path: string): Promise<string[]> {
		await using tx = this.transaction();
		const node = await this.findInode(tx, path);
		return Array.from(DirListing.decode((await tx.get(node.data)) ?? _throw(withErrno('ENOENT'))).keys());
	}

	public readdirSync(path: string): string[] {
		using tx = this.transaction();
		const node = this.findInodeSync(tx, path);
		return Array.from(DirListing.decode(tx.getSync(node.data) ?? _throw(withErrno('ENOENT'))).keys());
	}

	public async sync(): Promise<void> {}

	public syncSync(): void {}

	@retry
	public async link(target: string, link: string): Promise<void> {
		await using tx = this.transaction();

		const newDir: string = dirname(link),
			newDirNode = await this.findInode(tx, newDir),
			listing = DirListing.decode((await tx.get(newDirNode.data)) ?? _throw(withErrno('ENOENT')));

		const inode = await this.findInode(tx, target);

		inode.nlink++;

		this._add(inode.ino, link);
		await tx.set(inode.ino, inode);
		await tx.set(newDirNode.data, listing.with(basename(link), inode.ino, ifToDt(inode.mode)));
		await tx.commit();
	}

	@retry
	public linkSync(target: string, link: string): void {
		using tx = this.transaction();

		const newDir: string = dirname(link),
			newDirNode = this.findInodeSync(tx, newDir),
			listing = DirListing.decode(tx.getSync(newDirNode.data) ?? _throw(withErrno('ENOENT')));

		const inode = this.findInodeSync(tx, target);

		inode.nlink++;

		this._add(inode.ino, link);
		tx.setSync(inode.ino, inode);
		tx.setSync(newDirNode.data, listing.with(basename(link), inode.ino, ifToDt(inode.mode)));
		tx.commitSync();
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		await using tx = this.transaction();
		const inode = await this.findInode(tx, path);

		if (inode.size == 0) return;

		const data = (await tx.get(inode.data, offset, end)) ?? _throw(withErrno('ENODATA'));
		const _ = tx.flag('partial') ? data : data.subarray(offset, end);
		if (_.byteLength > buffer.byteLength) err(`Trying to place ${_.byteLength} bytes into a ${buffer.byteLength} byte buffer on read`);
		buffer.set(_);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		using tx = this.transaction();
		const inode = this.findInodeSync(tx, path);

		if (inode.size == 0) return;

		const data = tx.getSync(inode.data, offset, end) ?? _throw(withErrno('ENODATA'));
		const _ = tx.flag('partial') ? data : data.subarray(offset, end);
		if (_.byteLength > buffer.byteLength) err(`Trying to place ${_.byteLength} bytes into a ${buffer.byteLength} byte buffer on read`);
		buffer.set(_);
	}

	@retry
	public async write(path: string, data: Uint8Array, offset: number): Promise<void> {
		await using tx = this.transaction();

		const inode = await this.findInode(tx, path);
		const end = offset + data.byteLength;

		if (!tx.flag('partial')) {
			const buffer = extendBuffer((await tx.get(inode.data)) ?? new Uint8Array(), end);
			buffer.set(data, offset);
			await tx.set(inode.data, buffer);
		} else if (offset <= inode.size) {
			await tx.set(inode.data, data, offset);
		} else {
			// Writes past the end of the file also zero the bytes before them
			const extended = new Uint8Array(end - inode.size);
			extended.set(data, offset - inode.size);
			await tx.set(inode.data, extended, inode.size);
		}

		// Update the inode in the same transaction, so data and metadata can not get out of sync (#286)
		inode.update({ size: Math.max(inode.size, end), mtimeMs: Date.now() });
		await tx.set(inode.ino, inode);

		this._add(inode.ino, path);

		await tx.commit();
	}

	@retry
	public writeSync(path: string, data: Uint8Array, offset: number): void {
		using tx = this.transaction();

		const inode = this.findInodeSync(tx, path);
		const end = offset + data.byteLength;

		if (!tx.flag('partial')) {
			const buffer = extendBuffer(tx.getSync(inode.data) ?? new Uint8Array(), end);
			buffer.set(data, offset);
			tx.setSync(inode.data, buffer);
		} else if (offset <= inode.size) {
			tx.setSync(inode.data, data, offset);
		} else {
			// Writes past the end of the file also zero the bytes before them
			const extended = new Uint8Array(end - inode.size);
			extended.set(data, offset - inode.size);
			tx.setSync(inode.data, extended, inode.size);
		}

		// Update the inode in the same transaction, so data and metadata can not get out of sync (#286)
		inode.update({ size: Math.max(inode.size, end), mtimeMs: Date.now() });
		tx.setSync(inode.ino, inode);

		this._add(inode.ino, path);

		tx.commitSync();
	}

	/**
	 * Wraps a transaction
	 * @internal @hidden
	 */
	public transaction(): WrappedTransaction {
		return new WrappedTransaction(this.store.transaction(), this);
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	@retry
	public async checkRoot(): Promise<void> {
		await using tx = this.transaction();
		if (await tx.get(rootIno)) return;

		const inode = new Inode({ ino: rootIno, data: 1n, mode: 0o777 | S_IFDIR });
		await tx.set(inode.data, DirListing.from([]));

		this._add(rootIno, '/');
		await tx.set(rootIno, inode);
		await tx.commit();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	@retry
	public checkRootSync(): void {
		using tx = this.transaction();
		if (tx.getSync(rootIno)) return;

		const inode = new Inode({ ino: rootIno, data: 1n, mode: 0o777 | S_IFDIR });
		tx.setSync(inode.data, DirListing.from([]));

		this._add(rootIno, '/');
		tx.setSync(rootIno, inode);
		tx.commitSync();
	}

	/**
	 * Populates the `_ids` and `_paths` maps with all existing files stored in the underlying `Store`.
	 */
	private async _populate(): Promise<void> {
		if (this._initialized) {
			warn('Attempted to populate tables after initialization');
			return;
		}
		debug('Populating tables with existing store metadata');
		await using tx = this.transaction();

		const rootData = await tx.get(rootIno);
		if (!rootData) {
			notice('Store does not have a root inode');
			const inode = new Inode({ ino: rootIno, data: 1n, mode: 0o777 | S_IFDIR });
			await tx.set(inode.data, DirListing.from([]));
			this._add(rootIno, '/');
			await tx.set(rootIno, inode);
			await tx.commit();
			return;
		}

		if (rootData.length < sizeof(Inode)) {
			crit('Store contains an invalid root inode. Refusing to populate tables');
			return;
		}

		const visitedDirectories = new Set<bigint>();

		let i = 0,
			upgraded = 0;

		const queue: Array<[path: string, ino: bigint]> = [['/', rootIno]];

		while (queue.length > 0) {
			i++;
			const [path, ino] = queue.shift()!;

			this._add(ino, path);

			const inodeData = await tx.get(ino);
			if (!inodeData) {
				warn('Store is missing data for inode: ' + ino);
				continue;
			}

			if (inodeData.length < sizeof(Inode)) {
				warn(`Invalid inode size for ino ${ino}: ${inodeData.length}`);
				continue;
			}

			const inode = new Inode(inodeData);

			if (!isDirectory(inode) || visitedDirectories.has(ino)) continue;

			visitedDirectories.add(ino);

			const dirData = await tx.get(inode.data);
			if (!dirData) {
				warn('Store is missing directory data: ' + inode.data);
				continue;
			}
			let dirListing = DirListing.decode(dirData);

			if (DirListing.isLegacy(dirData)) {
				dirListing = await this._resolveTypes(tx, dirListing);
				await tx.set(inode.data, dirListing);
				upgraded++;
			}

			for (const [name, entry] of dirListing) {
				queue.push([join(path, name), entry.id]);
			}
		}

		debug(`Added ${i} existing inode(s) from store`);

		if (!upgraded) return;

		try {
			await tx.commit();
			notice(`Upgraded ${upgraded} directory listing(s)`);
		} catch (e) {
			warn('Failed to upgrade directory listings: ' + e);
		}
	}

	private _populateSync(): void {
		if (this._initialized) {
			warn('Attempted to populate tables after initialization');
			return;
		}
		debug('Populating tables with existing store metadata');
		using tx = this.transaction();

		const rootData = tx.getSync(rootIno);
		if (!rootData) {
			notice('Store does not have a root inode');
			const inode = new Inode({ ino: rootIno, data: 1n, mode: 0o777 | S_IFDIR });
			tx.setSync(inode.data, DirListing.from([]));
			this._add(rootIno, '/');
			tx.setSync(rootIno, inode);
			tx.commitSync();
			return;
		}

		if (rootData.length < sizeof(Inode)) {
			crit('Store contains an invalid root inode. Refusing to populate tables');
			return;
		}

		const visitedDirectories = new Set<bigint>();
		let i = 0,
			upgraded = 0;
		const queue: Array<[path: string, ino: bigint]> = [['/', rootIno]];

		while (queue.length > 0) {
			i++;
			const [path, ino] = queue.shift()!;

			this._add(ino, path);

			const inodeData = tx.getSync(ino);
			if (!inodeData) {
				warn('Store is missing data for inode: ' + ino);
				continue;
			}

			if (inodeData.length < sizeof(Inode)) {
				warn(`Invalid inode size for ino ${ino}: ${inodeData.length}`);
				continue;
			}

			const inode = new Inode(inodeData);

			if (!isDirectory(inode) || visitedDirectories.has(ino)) {
				continue;
			}

			visitedDirectories.add(ino);

			const dirData = tx.getSync(inode.data);
			if (!dirData) {
				warn('Store is missing directory data: ' + inode.data);
				continue;
			}
			let dirListing = DirListing.decode(dirData);

			if (DirListing.isLegacy(dirData)) {
				dirListing = this._resolveTypesSync(tx, dirListing);
				tx.setSync(inode.data, dirListing);
				upgraded++;
			}

			for (const [name, entry] of dirListing) {
				queue.push([join(path, name), entry.id]);
			}
		}

		debug(`Added ${i} existing inode(s) from store`);

		if (!upgraded) return;

		try {
			tx.commitSync();
			notice(`Upgraded ${upgraded} directory listing(s)`);
		} catch (e) {
			warn('Failed to upgrade directory listings: ' + e);
		}
	}

	/** Returns a copy of `listing` with the types of entries with an unknown type read from their inodes */
	private async _resolveTypes(tx: WrappedTransaction, listing: DirListing): Promise<DirListing> {
		const entries: DirEntryInit[] = [];
		for (const [name, entry] of listing) {
			const { id } = entry;
			let type: DirType = entry.type;
			if (type == DirType.UNKNOWN) {
				const data = await tx.get(id);
				if (data && data.length >= sizeof(Inode)) type = ifToDt(new Inode(data).mode);
			}
			entries.push({ name, id, type });
		}
		return DirListing.from(entries);
	}

	/** Returns a copy of `listing` with the types of entries with an unknown type read from their inodes */
	private _resolveTypesSync(tx: WrappedTransaction, listing: DirListing): DirListing {
		const entries: DirEntryInit[] = [];
		for (const [name, entry] of listing) {
			const { id } = entry;
			let type: DirType = entry.type;
			if (type == DirType.UNKNOWN) {
				const data = tx.getSync(id);
				if (data && data.length >= sizeof(Inode)) type = ifToDt(new Inode(data).mode);
			}
			entries.push({ name, id, type });
		}
		return DirListing.from(entries);
	}

	/**
	 * Find an inode without using the ID tables
	 */
	private async _findInode(tx: WrappedTransaction, path: string, visited: Set<string> = new Set()): Promise<Inode> {
		if (visited.has(path)) throw crit(withErrno('EIO', 'Infinite loop detected while finding inode'));

		visited.add(path);

		if (path == '/') return new Inode((await tx.get(rootIno)) ?? _throw(withErrno('ENODATA')));

		const { dir: parent, base: filename } = parse(path);
		const inode = await this._findInode(tx, parent, visited);
		const entry = DirListing.decode((await tx.get(inode.data)) ?? _throw(withErrno('ENODATA'))).get(filename);

		if (!entry) throw withErrno('ENOENT');

		return new Inode((await tx.get(entry.id)) ?? _throw(withErrno('ENODATA')));
	}

	/**
	 * Find an inode without using the ID tables
	 */
	private _findInodeSync(tx: WrappedTransaction, path: string, visited: Set<string> = new Set()): Inode {
		if (visited.has(path)) throw crit(withErrno('EIO', 'Infinite loop detected while finding inode'));

		visited.add(path);

		if (path == '/') return new Inode(tx.getSync(rootIno) ?? _throw(withErrno('ENOENT')));

		const { dir: parent, base: filename } = parse(path);
		const inode = this._findInodeSync(tx, parent, visited);
		const entry = DirListing.decode(tx.getSync(inode.data) ?? _throw(withErrno('ENODATA'))).get(filename);

		if (!entry) throw withErrno('ENOENT');

		return new Inode(tx.getSync(entry.id) ?? _throw(withErrno('ENODATA')));
	}

	/**
	 * Finds the Inode of `path`.
	 * @param path The path to look up.
	 * @todo memoize/cache
	 */
	protected async findInode(tx: WrappedTransaction, path: string): Promise<Inode> {
		if (this.attributes.has('no_id_tables')) return await this._findInode(tx, path);
		const ino = this._ids.get(path);
		if (ino === undefined) throw withErrno('ENOENT');
		return new Inode((await tx.get(ino)) ?? _throw(withErrno('ENOENT')));
	}

	/**
	 * Finds the Inode of `path`.
	 * @param path The path to look up.
	 * @return The Inode of the path p.
	 * @todo memoize/cache
	 */
	protected findInodeSync(tx: WrappedTransaction, path: string): Inode {
		if (this.attributes.has('no_id_tables')) return this._findInodeSync(tx, path);
		const ino = this._ids.get(path);
		if (ino === undefined) throw withErrno('ENOENT');
		return new Inode(tx.getSync(ino) ?? _throw(withErrno('ENOENT')));
	}

	private _lastID?: bigint;

	/** Allocates a new ID and adds the ID/path */
	protected allocNew(path: string): [bigint, bigint] {
		if (this.store.allocId) {
			const ids = this.store.allocId();
			this._add(ids[0], path);
			return ids;
		}

		// @todo use `Iterator` helper #296
		this._lastID ||= Array.from(this._paths.keys()).reduce((max, ino) => (ino > max ? ino : max), 0n);
		this._lastID += 2n;
		const id = this._lastID;
		if (id + 1n > id_max) throw err(withErrno('ENOSPC', 'No IDs available'));
		this._add(id, path);
		return [id, id + 1n];
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with `mode`.
	 * Note: This will commit the transaction.
	 * @param path The path to the new file.
	 * @param options The options to create the new file with.
	 * @param data The data to store at the file's data node.
	 */
	@retry
	protected async commitNew(path: string, options: CreationOptions, data: ArrayBufferView): Promise<Inode> {
		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root if path is '/'.
		*/
		if (path == '/') throw withErrno('EEXIST');

		await using tx = this.transaction();

		const { dir: parentPath, base: fname } = parse(path);
		const parent = await this.findInode(tx, parentPath);
		const listing = DirListing.decode((await tx.get(parent.data)) ?? _throw(withErrno('ENOENT')));

		if (listing.has(fname)) throw withErrno('EEXIST');

		const [ino, dataId] = this.allocNew(path);

		const inode = new Inode({
			...options,
			ino,
			data: dataId,
			size: data.byteLength,
			nlink: 1,
		});

		const updated = listing.with(fname, inode.ino, ifToDt(inode.mode));

		await tx.set(inode.ino, inode);
		await tx.set(inode.data, data);
		await tx.set(parent.data, updated);
		await tx.commit();
		return inode;
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with `mode`.
	 * Note: This will commit the transaction.
	 * @param path The path to the new file.
	 * @param options The options to create the new file with.
	 * @param data The data to store at the file's data node.
	 * @return The Inode for the new file.
	 */
	@retry
	protected commitNewSync(path: string, options: CreationOptions, data: ArrayBufferView): Inode {
		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root if path is '/'.
		*/
		if (path == '/') throw withErrno('EEXIST');

		using tx = this.transaction();

		const { dir: parentPath, base: fname } = parse(path);
		const parent = this.findInodeSync(tx, parentPath);

		const listing = DirListing.decode(tx.getSync(parent.data) ?? _throw(withErrno('ENOENT')));

		if (listing.has(fname)) throw withErrno('EEXIST');

		const [ino, dataId] = this.allocNew(path);

		const inode = new Inode({
			...options,
			ino,
			data: dataId,
			size: data.byteLength,
			nlink: 1,
		});

		const updated = listing.with(fname, inode.ino, ifToDt(inode.mode));

		tx.setSync(inode.ino, inode);
		tx.setSync(inode.data, data);
		tx.setSync(parent.data, updated);
		tx.commitSync();
		return inode;
	}

	/**
	 * Remove all traces of `path` from the file system.
	 * @param path The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 */
	@retry
	protected async remove(path: string, isDir: boolean): Promise<void> {
		await using tx = this.transaction();

		const { dir: parent, base: fileName } = parse(path),
			parentNode = await this.findInode(tx, parent),
			listing = DirListing.decode((await tx.get(parentNode.data)) ?? _throw(withErrno('ENOENT'))),
			entry = listing.get(fileName);

		if (!entry) throw withErrno('ENOENT');

		const ino = entry.id;
		const updated = listing.without(fileName);

		const inode = new Inode((await tx.get(ino)) ?? _throw(withErrno('ENOENT')));

		if (!isDir && isDirectory(inode)) throw withErrno('EISDIR');

		if (isDir && DirListing.decode((await tx.get(inode.data)) ?? _throw(withErrno('ENODATA'))).size) throw withErrno('ENOTEMPTY');

		await tx.set(parentNode.data, updated);

		if (inode.nlink > 1) {
			inode.update({ nlink: inode.nlink - 1 });
			await tx.set(inode.ino, inode);
		} else {
			await tx.remove(inode.data);
			await tx.remove(ino);
			this._remove(ino);
		}

		await tx.commit();
	}

	/**
	 * Remove all traces of `path` from the file system.
	 * @param path The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 */
	@retry
	protected removeSync(path: string, isDir: boolean): void {
		using tx = this.transaction();
		const { dir: parent, base: fileName } = parse(path),
			parentNode = this.findInodeSync(tx, parent),
			listing = DirListing.decode(tx.getSync(parentNode.data) ?? _throw(withErrno('ENOENT'))),
			entry = listing.get(fileName);

		if (!entry) throw withErrno('ENOENT');

		const ino = entry.id;
		const updated = listing.without(fileName);

		const inode = new Inode(tx.getSync(ino) ?? _throw(withErrno('ENOENT')));

		if (!isDir && isDirectory(inode)) throw withErrno('EISDIR');

		if (isDir && DirListing.decode(tx.getSync(inode.data) ?? _throw(withErrno('ENODATA'))).size) throw withErrno('ENOTEMPTY');

		tx.setSync(parentNode.data, updated);

		if (inode.nlink > 1) {
			inode.update({ nlink: inode.nlink - 1 });
			tx.setSync(inode.ino, inode);
		} else {
			tx.removeSync(inode.data);
			tx.removeSync(ino);
			this._remove(ino);
		}

		tx.commitSync();
	}
}
