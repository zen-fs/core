import { withErrno } from 'kerium';
import { crit, debug, err, notice, warn } from 'kerium/log';
import { sizeof } from 'memium';
import { _throw, canary, encodeUTF8 } from 'utilium';
import { extendBuffer } from 'utilium/buffer.js';
import { Index } from '../../internal/file_index.js';
import type { CreationOptions, UsageInfo } from '../../internal/filesystem.js';
import { FileSystem } from '../../internal/filesystem.js';
import { Inode, isDirectory, rootIno, type InodeLike } from '../../internal/inode.js';
import { basename, dirname, join, parse, relative } from '../../path.js';
import { decodeDirListing, encodeDirListing } from '../../utils.js';
import { S_IFDIR, S_IFREG, size_max } from '../../vfs/constants.js';
import { WrappedTransaction, type Store } from './store.js';

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
	readonly _ids = new Map<string, number>([['/', 0]]);

	/**
	 * A map of inode IDs to paths
	 * @internal @hidden
	 */
	readonly _paths = new Map<number, Set<string>>([[0, new Set('/')]]);

	/**
	 * Gets the first path associated with an inode
	 */
	_path(id: number): string | undefined {
		const [path] = this._paths.get(id) ?? [];
		return path;
	}

	/**
	 * Add a inode/path pair
	 */
	_add(ino: number, path: string) {
		if (!this._paths.has(ino)) this._paths.set(ino, new Set());
		this._paths.get(ino)!.add(path);
		this._ids.set(path, ino);
	}

	/**
	 * Remove a inode/path pair
	 */
	_remove(ino: number) {
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

		this.checkRootSync();
		await this.checkRoot();
		await this._populate();
		this._initialized = true;
	}

	public constructor(protected readonly store: T) {
		super(store.type ?? 0x6b766673, store.name);
		store._fs = this;
		this._uuid = store.uuid ?? this.uuid;
		this.label = store.label;
		debug(this.name + ': supports features: ' + this.store.flags?.join(', '));
	}

	/**
	 * @experimental
	 */
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
			if (dirs.has(path)) await tx.set(inode.data, encodeDirListing(dirs.get(path)!));
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
			if (dirs.has(path)) tx.setSync(inode.data, encodeDirListing(dirs.get(path)!));
		}

		tx.commitSync();
	}

	public async createIndex(): Promise<Index> {
		const index = new Index();

		await using tx = this.transaction();

		const queue: [path: string, ino: number][] = [['/', 0]];

		const silence = canary(withErrno('EDEADLK'));
		while (queue.length) {
			const [path, ino] = queue.shift()!;

			const inode = new Inode(await tx.get(ino));

			index.set(path, inode);

			if (inode.mode & S_IFDIR) {
				const dir = decodeDirListing((await tx.get(inode.data)) ?? _throw(withErrno('ENODATA')));

				for (const [name, id] of Object.entries(dir)) {
					queue.push([join(path, name), id]);
				}
			}
		}
		silence();

		return index;
	}

	public createIndexSync(): Index {
		const index = new Index();

		using tx = this.transaction();

		const queue: [path: string, ino: number][] = [['/', 0]];

		const silence = canary(withErrno('EDEADLK'));
		while (queue.length) {
			const [path, ino] = queue.shift()!;

			const inode = new Inode(tx.getSync(ino));

			index.set(path, inode);

			if (inode.mode & S_IFDIR) {
				const dir = decodeDirListing(tx.getSync(inode.data) ?? _throw(withErrno('ENODATA')));

				for (const [name, id] of Object.entries(dir)) {
					queue.push([join(path, name), id]);
				}
			}
		}
		silence();

		return index;
	}

	/**
	 * @todo Make rename compatible with the cache.
	 */
	public async rename(oldPath: string, newPath: string): Promise<void> {
		await using tx = this.transaction();
		const _old = parse(oldPath),
			_new = parse(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = await this.findInode(tx, _old.dir),
			oldDirList = decodeDirListing((await tx.get(oldDirNode.data)) ?? _throw(withErrno('ENODATA')));

		if (!oldDirList[_old.base]) throw withErrno('ENOENT');

		const ino: number = oldDirList[_old.base];

		if (ino != this._ids.get(oldPath)) err(`Ino mismatch while renaming ${oldPath} to ${newPath}`);

		delete oldDirList[_old.base];

		/* 
			Can't move a folder inside itself.
			This ensures that the check passes only if `oldPath` is a subpath of `_new.dir`.
			We append '/' to avoid matching folders that are a substring of the bottom-most folder in the path.
		*/
		if ((_new.dir + '/').startsWith(oldPath + '/')) throw withErrno('EBUSY');

		const sameParent = _new.dir == _old.dir;

		// Prevent us from re-grabbing the same directory listing, which still contains `old_path.base.`
		const newDirNode: Inode = sameParent ? oldDirNode : await this.findInode(tx, _new.dir);
		const newDirList: typeof oldDirList = sameParent
			? oldDirList
			: decodeDirListing((await tx.get(newDirNode.data)) ?? _throw(withErrno('ENODATA')));

		if (newDirList[_new.base]) {
			const existing = new Inode((await tx.get(newDirList[_new.base])) ?? _throw(withErrno('ENOENT')));
			if (!existing.toStats().isFile()) throw withErrno('EISDIR');

			await tx.remove(existing.data);
			await tx.remove(newDirList[_new.base]);
		}
		newDirList[_new.base] = ino;
		// Commit the two changed directory listings.
		await tx.set(oldDirNode.data, encodeDirListing(oldDirList));
		await tx.set(newDirNode.data, encodeDirListing(newDirList));
		await tx.commit();
		this._move(oldPath, newPath);
	}

	public renameSync(oldPath: string, newPath: string): void {
		using tx = this.transaction();
		const _old = parse(oldPath),
			_new = parse(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = this.findInodeSync(tx, _old.dir),
			oldDirList = decodeDirListing(tx.getSync(oldDirNode.data) ?? _throw(withErrno('ENODATA')));

		if (!oldDirList[_old.base]) throw withErrno('ENOENT');

		const ino: number = oldDirList[_old.base];

		if (ino != this._ids.get(oldPath)) err(`Ino mismatch while renaming ${oldPath} to ${newPath}`);

		delete oldDirList[_old.base];

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
		const newDirList: typeof oldDirList = sameParent ? oldDirList : decodeDirListing(tx.getSync(newDirNode.data) ?? _throw(withErrno('ENODATA')));

		if (newDirList[_new.base]) {
			const existing = new Inode(tx.getSync(newDirList[_new.base]) ?? _throw(withErrno('ENOENT')));
			if (!existing.toStats().isFile()) throw withErrno('EISDIR');

			tx.removeSync(existing.data);
			tx.removeSync(newDirList[_new.base]);
		}
		newDirList[_new.base] = ino;

		// Commit the two changed directory listings.
		tx.setSync(oldDirNode.data, encodeDirListing(oldDirList));
		tx.setSync(newDirNode.data, encodeDirListing(newDirList));
		tx.commitSync();
		this._move(oldPath, newPath);
	}

	public async stat(path: string): Promise<InodeLike> {
		await using tx = this.transaction();
		return await this.findInode(tx, path);
	}

	public statSync(path: string): InodeLike {
		using tx = this.transaction();
		return this.findInodeSync(tx, path);
	}

	public async touch(path: string, metadata: Partial<InodeLike>): Promise<void> {
		await using tx = this.transaction();
		const inode = await this.findInode(tx, path);

		if (inode.update(metadata)) {
			this._add(inode.ino, path);
			tx.setSync(inode.ino, inode);
		}

		await tx.commit();
	}

	public touchSync(path: string, metadata: Partial<InodeLike>): void {
		using tx = this.transaction();

		const inode = this.findInodeSync(tx, path);

		if (inode.update(metadata)) {
			this._add(inode.ino, path);
			tx.setSync(inode.ino, inode);
		}

		tx.commitSync();
	}

	public async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		options.mode |= S_IFREG;
		return await this.commitNew(path, options, new Uint8Array());
	}

	public createFileSync(path: string, options: CreationOptions): InodeLike {
		options.mode |= S_IFREG;
		return this.commitNewSync(path, options, new Uint8Array());
	}

	public async unlink(path: string): Promise<void> {
		return this.remove(path, false);
	}

	public unlinkSync(path: string): void {
		this.removeSync(path, false);
	}

	public async rmdir(path: string): Promise<void> {
		if ((await this.readdir(path)).length) throw withErrno('ENOTEMPTY');
		await this.remove(path, true);
	}

	public rmdirSync(path: string): void {
		if (this.readdirSync(path).length) throw withErrno('ENOTEMPTY');
		this.removeSync(path, true);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		options.mode |= S_IFDIR;
		return await this.commitNew(path, options, encodeUTF8('{}'));
	}

	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		options.mode |= S_IFDIR;
		return this.commitNewSync(path, options, encodeUTF8('{}'));
	}

	public async readdir(path: string): Promise<string[]> {
		await using tx = this.transaction();
		const node = await this.findInode(tx, path);
		return Object.keys(decodeDirListing((await tx.get(node.data)) ?? _throw(withErrno('ENOENT'))));
	}

	public readdirSync(path: string): string[] {
		using tx = this.transaction();
		const node = this.findInodeSync(tx, path);
		return Object.keys(decodeDirListing(tx.getSync(node.data) ?? _throw(withErrno('ENOENT'))));
	}

	/**
	 * Updated the inode and data node at `path`
	 */
	public async sync(path: string, data?: Uint8Array, metadata?: Readonly<InodeLike>): Promise<void> {
		await using tx = this.transaction();

		const inode = await this.findInode(tx, path);

		if (data) await tx.set(inode.data, data);

		if (inode.update(metadata)) {
			this._add(inode.ino, path);
			await tx.set(inode.ino, inode);
		}

		await tx.commit();
	}

	/**
	 * Updated the inode and data node at `path`
	 */
	public syncSync(path: string, data?: Uint8Array, metadata?: Readonly<InodeLike>): void {
		using tx = this.transaction();

		const inode = this.findInodeSync(tx, path);

		if (data) tx.setSync(inode.data, data);

		if (inode.update(metadata)) {
			this._add(inode.ino, path);
			tx.setSync(inode.ino, inode);
		}

		tx.commitSync();
	}

	public async link(target: string, link: string): Promise<void> {
		await using tx = this.transaction();

		const newDir: string = dirname(link),
			newDirNode = await this.findInode(tx, newDir),
			listing = decodeDirListing((await tx.get(newDirNode.data)) ?? _throw(withErrno('ENOENT')));

		const inode = await this.findInode(tx, target);

		inode.nlink++;
		listing[basename(link)] = inode.ino;

		this._add(inode.ino, link);
		await tx.set(inode.ino, inode);
		await tx.set(newDirNode.data, encodeDirListing(listing));
		await tx.commit();
	}

	public linkSync(target: string, link: string): void {
		using tx = this.transaction();

		const newDir: string = dirname(link),
			newDirNode = this.findInodeSync(tx, newDir),
			listing = decodeDirListing(tx.getSync(newDirNode.data) ?? _throw(withErrno('ENOENT')));

		const inode = this.findInodeSync(tx, target);

		inode.nlink++;
		listing[basename(link)] = inode.ino;

		this._add(inode.ino, link);
		tx.setSync(inode.ino, inode);
		tx.setSync(newDirNode.data, encodeDirListing(listing));
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

	public async write(path: string, data: Uint8Array, offset: number): Promise<void> {
		await using tx = this.transaction();

		const inode = await this.findInode(tx, path);

		let buffer = data;
		if (!tx.flag('partial')) {
			buffer = extendBuffer((await tx.get(inode.data)) ?? new Uint8Array(), offset + data.byteLength);
			buffer.set(data, offset);
			offset = 0;
		}

		await tx.set(inode.data, buffer, offset);

		this._add(inode.ino, path);

		await tx.commit();
	}

	public writeSync(path: string, data: Uint8Array, offset: number): void {
		using tx = this.transaction();

		const inode = this.findInodeSync(tx, path);

		let buffer = data;
		if (!tx.flag('partial')) {
			buffer = extendBuffer(tx.getSync(inode.data) ?? new Uint8Array(), offset + data.byteLength);
			buffer.set(data, offset);
			offset = 0;
		}

		tx.setSync(inode.data, buffer, offset);

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
	public async checkRoot(): Promise<void> {
		await using tx = this.transaction();
		if (await tx.get(rootIno)) return;

		const inode = new Inode({ ino: rootIno, data: 1, mode: 0o777 | S_IFDIR });
		await tx.set(inode.data, encodeUTF8('{}'));

		this._add(rootIno, '/');
		await tx.set(rootIno, inode);
		await tx.commit();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	public checkRootSync(): void {
		using tx = this.transaction();
		if (tx.getSync(rootIno)) return;

		const inode = new Inode({ ino: rootIno, data: 1, mode: 0o777 | S_IFDIR });
		tx.setSync(inode.data, encodeUTF8('{}'));

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
			const inode = new Inode({ ino: rootIno, data: 1, mode: 0o777 | S_IFDIR });
			await tx.set(inode.data, encodeUTF8('{}'));
			this._add(rootIno, '/');
			await tx.set(rootIno, inode);
			await tx.commit();
			return;
		}

		if (rootData.length < sizeof(Inode)) {
			crit('Store contains an invalid root inode. Refusing to populate tables');
			return;
		}

		// Keep track of directories we have already traversed to avoid loops
		const visitedDirectories = new Set<number>();

		let i = 0;

		// Start BFS from root
		const queue: Array<[path: string, ino: number]> = [['/', rootIno]];

		while (queue.length > 0) {
			i++;
			const [path, ino] = queue.shift()!;

			this._add(ino, path);

			// Get the inode data from the store
			const inodeData = await tx.get(ino);
			if (!inodeData) {
				warn('Store is missing data for inode: ' + ino);
				continue;
			}

			if (inodeData.length < sizeof(Inode)) {
				warn(`Invalid inode size for ino ${ino}: ${inodeData.length}`);
				continue;
			}

			// Parse the raw data into our Inode object
			const inode = new Inode(inodeData);

			// If it is a directory and not yet visited, read its directory listing
			if ((inode.mode & S_IFDIR) != S_IFDIR || visitedDirectories.has(ino)) {
				continue;
			}

			visitedDirectories.add(ino);

			// Grab the directory listing from the store
			const dirData = await tx.get(inode.data);
			if (!dirData) {
				warn('Store is missing directory data: ' + inode.data);
				continue;
			}
			const dirListing = decodeDirListing(dirData);

			for (const [entryName, childIno] of Object.entries(dirListing)) {
				queue.push([join(path, entryName), childIno]);
			}
		}

		debug(`Added ${i} existing inode(s) from store`);
	}

	/**
	 * Finds the Inode of `path`.
	 * @param path The path to look up.
	 * @todo memoize/cache
	 */
	protected async findInode(tx: WrappedTransaction, path: string): Promise<Inode> {
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
		const ino = this._ids.get(path);
		if (ino === undefined) throw withErrno('ENOENT');
		return new Inode(tx.getSync(ino) ?? _throw(withErrno('ENOENT')));
	}

	private _lastID?: number;

	/** Allocates a new ID and adds the ID/path */
	protected allocNew(path: string): number {
		this._lastID ??= Math.max(...this._paths.keys());
		this._lastID += 2;
		const id = this._lastID;
		if (id > size_max) throw err(withErrno('ENOSPC', 'No IDs available'));
		this._add(id, path);
		return id;
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with `mode`.
	 * Note: This will commit the transaction.
	 * @param path The path to the new file.
	 * @param options The options to create the new file with.
	 * @param data The data to store at the file's data node.
	 */
	protected async commitNew(path: string, options: CreationOptions, data: Uint8Array): Promise<Inode> {
		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root if path is '/'.
		*/
		if (path == '/') throw withErrno('EEXIST');

		await using tx = this.transaction();

		const { dir: parentPath, base: fname } = parse(path);
		const parent = await this.findInode(tx, parentPath);
		const listing = decodeDirListing((await tx.get(parent.data)) ?? _throw(withErrno('ENOENT')));

		// Check if file already exists.
		if (listing[fname]) throw withErrno('EEXIST');

		const id = this.allocNew(path);

		// Commit data.
		const inode = new Inode({
			...options,
			ino: id,
			data: id + 1,
			size: data.byteLength,
			nlink: 1,
		});

		await tx.set(inode.ino, inode);
		await tx.set(inode.data, data);

		// Update and commit parent directory listing.
		listing[fname] = inode.ino;
		await tx.set(parent.data, encodeDirListing(listing));
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
	protected commitNewSync(path: string, options: CreationOptions, data: Uint8Array): Inode {
		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root if path is '/'.
		*/
		if (path == '/') throw withErrno('EEXIST');

		using tx = this.transaction();

		const { dir: parentPath, base: fname } = parse(path);
		const parent = this.findInodeSync(tx, parentPath);

		const listing = decodeDirListing(tx.getSync(parent.data) ?? _throw(withErrno('ENOENT')));

		if (listing[fname]) throw withErrno('EEXIST');

		const id = this.allocNew(path);

		const inode = new Inode({
			...options,
			ino: id,
			data: id + 1,
			size: data.byteLength,
			nlink: 1,
		});

		// Update and commit parent directory listing.
		tx.setSync(inode.ino, inode);
		tx.setSync(inode.data, data);
		listing[fname] = inode.ino;
		tx.setSync(parent.data, encodeDirListing(listing));
		tx.commitSync();
		return inode;
	}

	/**
	 * Remove all traces of `path` from the file system.
	 * @param path The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 */
	protected async remove(path: string, isDir: boolean): Promise<void> {
		await using tx = this.transaction();

		const { dir: parent, base: fileName } = parse(path),
			parentNode = await this.findInode(tx, parent),
			listing = decodeDirListing((await tx.get(parentNode.data)) ?? _throw(withErrno('ENOENT')));

		if (!listing[fileName]) throw withErrno('ENOENT');

		const ino = listing[fileName];

		const inode = new Inode((await tx.get(ino)) ?? _throw(withErrno('ENOENT')));

		delete listing[fileName];

		if (!isDir && isDirectory(inode)) throw withErrno('EISDIR');

		await tx.set(parentNode.data, encodeDirListing(listing));

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
	protected removeSync(path: string, isDir: boolean): void {
		using tx = this.transaction();
		const { dir: parent, base: fileName } = parse(path),
			parentNode = this.findInodeSync(tx, parent),
			listing = decodeDirListing(tx.getSync(parentNode.data) ?? _throw(withErrno('ENOENT'))),
			ino: number = listing[fileName];

		if (!ino) throw withErrno('ENOENT');

		const inode = new Inode(tx.getSync(ino) ?? _throw(withErrno('ENOENT')));

		delete listing[fileName];

		if (!isDir && isDirectory(inode)) throw withErrno('EISDIR');

		tx.setSync(parentNode.data, encodeDirListing(listing));

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
