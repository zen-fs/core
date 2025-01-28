import { _throw, canary, serialize } from 'utilium';
import { extendBuffer } from 'utilium/buffer.js';
import { Errno, ErrnoError } from '../../error.js';
import type { File } from '../../file.js';
import { LazyFile } from '../../file.js';
import type { CreationOptions, FileSystemMetadata, PureCreationOptions } from '../../filesystem.js';
import { FileSystem } from '../../filesystem.js';
import { crit, debug, err, log_deprecated, notice, warn } from '../../log.js';
import type { Stats } from '../../stats.js';
import { decodeDirListing, encodeDirListing, encodeUTF8 } from '../../utils.js';
import { S_IFDIR, S_IFREG, S_ISGID, S_ISUID, size_max } from '../../vfs/constants.js';
import { basename, dirname, join, parse, relative } from '../../vfs/path.js';
import { Index } from './file_index.js';
import { __inode_sz, Inode, rootIno, type InodeLike } from './inode.js';
import { WrappedTransaction, type Store } from './store.js';

/**
 * A file system which uses a key-value store.
 *
 * We use a unique ID for each node in the file system. The root node has a fixed ID.
 *
 * @todo Introduce Node ID caching?
 * @todo Check modes?
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
		super();
		store._fs = this;
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: this.store.name,
			features: ['setid'],
		};
	}

	/* node:coverage disable */
	/**
	 * Delete all contents stored in the file system.
	 * @deprecated
	 */
	public async empty(): Promise<void> {
		log_deprecated('StoreFS#empty');
		// Root always exists.
		await this.checkRoot();
	}

	/**
	 * Delete all contents stored in the file system.
	 * @deprecated
	 */
	public emptySync(): void {
		log_deprecated('StoreFS#emptySync');
		// Root always exists.
		this.checkRootSync();
	}
	/* node:coverage enable */

	/**
	 * Load an index into the StoreFS.
	 * You *must* manually add non-directory files
	 */
	public async loadIndex(index: Index): Promise<void> {
		await using tx = this.transaction();

		const dirs = index.directories();

		for (const [path, inode] of index) {
			this._add(inode.ino, path);
			await tx.set(inode.ino, serialize(inode));
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
			tx.setSync(inode.ino, serialize(inode));
			if (dirs.has(path)) tx.setSync(inode.data, encodeDirListing(dirs.get(path)!));
		}

		tx.commitSync();
	}

	public async createIndex(): Promise<Index> {
		const index = new Index();

		await using tx = this.transaction();

		const queue: [path: string, ino: number][] = [['/', 0]];

		const silence = canary(ErrnoError.With('EDEADLK'));
		while (queue.length) {
			const [path, ino] = queue.shift()!;

			const inode = new Inode(await tx.get(ino));

			index.set(path, inode);

			if (inode.mode & S_IFDIR) {
				const dir = decodeDirListing((await tx.get(inode.data)) ?? _throw(ErrnoError.With('ENODATA', path)));

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

		const silence = canary(ErrnoError.With('EDEADLK'));
		while (queue.length) {
			const [path, ino] = queue.shift()!;

			const inode = new Inode(tx.getSync(ino));

			index.set(path, inode);

			if (inode.mode & S_IFDIR) {
				const dir = decodeDirListing(tx.getSync(inode.data) ?? _throw(ErrnoError.With('ENODATA', path)));

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
			oldDirNode = await this.findInode(tx, _old.dir, 'rename'),
			oldDirList = decodeDirListing((await tx.get(oldDirNode.data)) ?? _throw(ErrnoError.With('ENODATA', _old.dir, 'rename')));

		if (!oldDirList[_old.base]) throw ErrnoError.With('ENOENT', oldPath, 'rename');

		const ino: number = oldDirList[_old.base];

		if (ino != this._ids.get(oldPath)) err(`Ino mismatch while renaming ${oldPath} to ${newPath}`);

		delete oldDirList[_old.base];

		/* 
			Can't move a folder inside itself.
			This ensures that the check passes only if `oldPath` is a subpath of `_new.dir`.
			We append '/' to avoid matching folders that are a substring of the bottom-most folder in the path.
		*/
		if ((_new.dir + '/').indexOf(oldPath + '/') === 0) throw new ErrnoError(Errno.EBUSY, _old.dir);

		// Add newPath to parent's directory listing.

		const sameParent = _new.dir == _old.dir;

		// Prevent us from re-grabbing the same directory listing, which still contains `old_path.base.`
		const newDirNode: Inode = sameParent ? oldDirNode : await this.findInode(tx, _new.dir, 'rename');
		const newDirList: typeof oldDirList = sameParent
			? oldDirList
			: decodeDirListing((await tx.get(newDirNode.data)) ?? _throw(ErrnoError.With('ENODATA', _new.dir, 'rename')));

		if (newDirList[_new.base]) {
			// If it's a file, delete it, if it's a directory, throw a permissions error.
			const existing = new Inode((await tx.get(newDirList[_new.base])) ?? _throw(ErrnoError.With('ENOENT', newPath, 'rename')));
			if (!existing.toStats().isFile()) throw ErrnoError.With('EPERM', newPath, 'rename');

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
			oldDirNode = this.findInodeSync(tx, _old.dir, 'rename'),
			oldDirList = decodeDirListing(tx.getSync(oldDirNode.data) ?? _throw(ErrnoError.With('ENODATA', _old.dir, 'rename')));

		if (!oldDirList[_old.base]) throw ErrnoError.With('ENOENT', oldPath, 'rename');

		const ino: number = oldDirList[_old.base];

		if (ino != this._ids.get(oldPath)) err(`Ino mismatch while renaming ${oldPath} to ${newPath}`);

		delete oldDirList[_old.base];

		/* 
			Can't move a folder inside itself.
			This ensures that the check passes only if `oldPath` is a subpath of `_new.dir`.
			We append '/' to avoid matching folders that are a substring of the bottom-most folder in the path.
		*/
		if ((_new.dir + '/').indexOf(oldPath + '/') == 0) throw new ErrnoError(Errno.EBUSY, _old.dir);

		// Add newPath to parent's directory listing.
		const sameParent = _new.dir === _old.dir;

		// Prevent us from re-grabbing the same directory listing, which still contains `old_path.base.`
		const newDirNode: Inode = sameParent ? oldDirNode : this.findInodeSync(tx, _new.dir, 'rename');
		const newDirList: typeof oldDirList = sameParent
			? oldDirList
			: decodeDirListing(tx.getSync(newDirNode.data) ?? _throw(ErrnoError.With('ENODATA', _new.dir, 'rename')));

		if (newDirList[_new.base]) {
			// If it's a file, delete it, if it's a directory, throw a permissions error.
			const existing = new Inode(tx.getSync(newDirList[_new.base]) ?? _throw(ErrnoError.With('ENOENT', newPath, 'rename')));
			if (!existing.toStats().isFile()) throw ErrnoError.With('EPERM', newPath, 'rename');

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

	public async stat(path: string): Promise<Stats> {
		await using tx = this.transaction();
		return (await this.findInode(tx, path, 'stat')).toStats();
	}

	public statSync(path: string): Stats {
		using tx = this.transaction();
		return this.findInodeSync(tx, path, 'stat').toStats();
	}

	public async createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File> {
		const node = await this.commitNew(path, { mode: mode | S_IFREG, ...options }, new Uint8Array(), 'createFile');
		return new LazyFile(this, path, flag, node.toStats());
	}

	public createFileSync(path: string, flag: string, mode: number, options: CreationOptions): File {
		const node = this.commitNewSync(path, { mode: mode | S_IFREG, ...options }, new Uint8Array(), 'createFile');
		return new LazyFile(this, path, flag, node.toStats());
	}

	public async openFile(path: string, flag: string): Promise<File> {
		await using tx = this.transaction();
		const node = await this.findInode(tx, path, 'openFile');

		return new LazyFile(this, path, flag, node.toStats());
	}

	public openFileSync(path: string, flag: string): File {
		using tx = this.transaction();
		const node = this.findInodeSync(tx, path, 'openFile');

		return new LazyFile(this, path, flag, node.toStats());
	}

	public async unlink(path: string): Promise<void> {
		return this.remove(path, false);
	}

	public unlinkSync(path: string): void {
		this.removeSync(path, false);
	}

	public async rmdir(path: string): Promise<void> {
		if ((await this.readdir(path)).length) {
			throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		}
		await this.remove(path, true);
	}

	public rmdirSync(path: string): void {
		if (this.readdirSync(path).length) {
			throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		}
		this.removeSync(path, true);
	}

	public async mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
		await this.commitNew(path, { mode: mode | S_IFDIR, ...options }, encodeUTF8('{}'), 'mkdir');
	}

	public mkdirSync(path: string, mode: number, options: CreationOptions): void {
		this.commitNewSync(path, { mode: mode | S_IFDIR, ...options }, encodeUTF8('{}'), 'mkdir');
	}

	public async readdir(path: string): Promise<string[]> {
		await using tx = this.transaction();
		const node = await this.findInode(tx, path, 'readdir');
		return Object.keys(decodeDirListing((await tx.get(node.data)) ?? _throw(ErrnoError.With('ENOENT', path, 'readdir'))));
	}

	public readdirSync(path: string): string[] {
		using tx = this.transaction();
		const node = this.findInodeSync(tx, path, 'readdir');
		return Object.keys(decodeDirListing(tx.getSync(node.data) ?? _throw(ErrnoError.With('ENOENT', path, 'readdir'))));
	}

	/**
	 * Updated the inode and data node at `path`
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public async sync(path: string, data?: Uint8Array, metadata?: Readonly<InodeLike>): Promise<void> {
		await using tx = this.transaction();

		const inode = await this.findInode(tx, path, 'sync');

		if (data) await tx.set(inode.data, data);

		if (inode.update(metadata)) {
			this._add(inode.ino, path);
			await tx.set(inode.ino, serialize(inode));
		}

		await tx.commit();
	}

	/**
	 * Updated the inode and data node at `path`
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public syncSync(path: string, data?: Uint8Array, metadata?: Readonly<InodeLike>): void {
		using tx = this.transaction();

		const inode = this.findInodeSync(tx, path, 'sync');

		if (data) tx.setSync(inode.data, data);

		if (inode.update(metadata)) {
			this._add(inode.ino, path);
			tx.setSync(inode.ino, serialize(inode));
		}

		tx.commitSync();
	}

	public async link(target: string, link: string): Promise<void> {
		await using tx = this.transaction();

		const newDir: string = dirname(link),
			newDirNode = await this.findInode(tx, newDir, 'link'),
			listing = decodeDirListing((await tx.get(newDirNode.data)) ?? _throw(ErrnoError.With('ENOENT', newDir, 'link')));

		const inode = await this.findInode(tx, target, 'link');

		inode.nlink++;
		listing[basename(link)] = inode.ino;

		this._add(inode.ino, link);
		await tx.set(inode.ino, serialize(inode));
		await tx.set(newDirNode.data, encodeDirListing(listing));
		await tx.commit();
	}

	public linkSync(target: string, link: string): void {
		using tx = this.transaction();

		const newDir: string = dirname(link),
			newDirNode = this.findInodeSync(tx, newDir, 'link'),
			listing = decodeDirListing(tx.getSync(newDirNode.data) ?? _throw(ErrnoError.With('ENOENT', newDir, 'link')));

		const inode = this.findInodeSync(tx, target, 'link');

		inode.nlink++;
		listing[basename(link)] = inode.ino;

		this._add(inode.ino, link);
		tx.setSync(inode.ino, serialize(inode));
		tx.setSync(newDirNode.data, encodeDirListing(listing));
		tx.commitSync();
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		await using tx = this.transaction();
		const inode = await this.findInode(tx, path, 'read');

		const data = (await tx.get(inode.data, offset, end)) ?? _throw(ErrnoError.With('ENODATA', path, 'read'));
		const _ = tx.flag('partial') ? data : data.subarray(offset, end);
		if (_.byteLength > buffer.byteLength) err(`Trying to place ${_.byteLength} bytes into a ${buffer.byteLength} byte buffer on read`);
		buffer.set(_);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		using tx = this.transaction();
		const inode = this.findInodeSync(tx, path, 'read');

		const data = tx.getSync(inode.data, offset, end) ?? _throw(ErrnoError.With('ENODATA', path, 'read'));
		const _ = tx.flag('partial') ? data : data.subarray(offset, end);
		if (_.byteLength > buffer.byteLength) err(`Trying to place ${_.byteLength} bytes into a ${buffer.byteLength} byte buffer on read`);
		buffer.set(_);
	}

	public async write(path: string, data: Uint8Array, offset: number): Promise<void> {
		await using tx = this.transaction();

		const inode = await this.findInode(tx, path, 'write');

		let buffer = data;
		if (!tx.flag('partial')) {
			buffer = extendBuffer((await tx.get(inode.data)) ?? _throw(ErrnoError.With('ENODATA', path)), offset + data.byteLength);
			buffer.set(data, offset);
			offset = 0;
		}

		await tx.set(inode.data, buffer, offset);

		inode.update({ mtimeMs: Date.now(), size: Math.max(inode.size, data.byteLength + offset) });
		this._add(inode.ino, path);
		await tx.set(inode.ino, serialize(inode));

		await tx.commit();
	}

	public writeSync(path: string, data: Uint8Array, offset: number): void {
		using tx = this.transaction();

		const inode = this.findInodeSync(tx, path, 'write');

		let buffer = data;
		if (!tx.flag('partial')) {
			buffer = extendBuffer(tx.getSync(inode.data) ?? _throw(ErrnoError.With('ENODATA', path)), offset + data.byteLength);
			buffer.set(data, offset);
			offset = 0;
		}

		tx.setSync(inode.data, buffer, offset);

		inode.update({ mtimeMs: Date.now(), size: Math.max(inode.size, data.byteLength + offset) });
		this._add(inode.ino, path);
		tx.setSync(inode.ino, serialize(inode));

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
		await tx.set(rootIno, serialize(inode));
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
		tx.setSync(rootIno, serialize(inode));
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
		debug('Populating tables with existing store metadata.');
		await using tx = this.transaction();

		const rootData = await tx.get(rootIno);
		if (!rootData) {
			notice('Store does not have a root inode.');
			const inode = new Inode({ ino: rootIno, data: 1, mode: 0o777 | S_IFDIR });
			await tx.set(inode.data, encodeUTF8('{}'));
			this._add(rootIno, '/');
			await tx.set(rootIno, serialize(inode));
			await tx.commit();
			return;
		}

		if (rootData.length != __inode_sz) {
			crit('Store contains an invalid root inode. Refusing to populate tables.');
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

			if (inodeData.length != __inode_sz) {
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
	protected async findInode(tx: WrappedTransaction, path: string, syscall: string): Promise<Inode> {
		const ino = this._ids.get(path);
		if (ino === undefined) throw ErrnoError.With('ENOENT', path, syscall);
		return new Inode((await tx.get(ino)) ?? _throw(ErrnoError.With('ENOENT', path, syscall)));
	}

	/**
	 * Finds the Inode of `path`.
	 * @param path The path to look up.
	 * @return The Inode of the path p.
	 * @todo memoize/cache
	 */
	protected findInodeSync(tx: WrappedTransaction, path: string, syscall: string): Inode {
		const ino = this._ids.get(path);
		if (ino === undefined) throw ErrnoError.With('ENOENT', path, syscall);
		return new Inode(tx.getSync(ino) ?? _throw(ErrnoError.With('ENOENT', path, syscall)));
	}

	private _lastID?: number;

	/**
	 * Allocates a new ID and adds the ID/path
	 */
	protected allocNew(path: string, syscall: string): number {
		this._lastID ??= Math.max(...this._paths.keys());
		this._lastID += 2;
		const id = this._lastID;
		if (id > size_max) throw err(new ErrnoError(Errno.ENOSPC, 'No IDs available', path, syscall), { fs: this });
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
	protected async commitNew(path: string, options: PureCreationOptions, data: Uint8Array, syscall: string): Promise<Inode> {
		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root if path is '/'.
		*/
		if (path == '/') throw ErrnoError.With('EEXIST', path, syscall);

		await using tx = this.transaction();

		const { dir: parentPath, base: fname } = parse(path);
		const parent = await this.findInode(tx, parentPath, syscall);
		const listing = decodeDirListing((await tx.get(parent.data)) ?? _throw(ErrnoError.With('ENOENT', parentPath, syscall)));

		// Check if file already exists.
		if (listing[fname]) throw ErrnoError.With('EEXIST', path, syscall);

		const id = this.allocNew(path, syscall);

		// Commit data.
		const inode = new Inode({
			ino: id,
			data: id + 1,
			mode: options.mode,
			size: data.byteLength,
			uid: parent.mode & S_ISUID ? parent.uid : options.uid,
			gid: parent.mode & S_ISGID ? parent.gid : options.gid,
		});

		await tx.set(inode.ino, serialize(inode));
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
	protected commitNewSync(path: string, options: PureCreationOptions, data: Uint8Array, syscall: string): Inode {
		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root if path is '/'.
		*/
		if (path == '/') throw ErrnoError.With('EEXIST', path, syscall);

		using tx = this.transaction();

		const { dir: parentPath, base: fname } = parse(path);
		const parent = this.findInodeSync(tx, parentPath, syscall);

		const listing = decodeDirListing(tx.getSync(parent.data) ?? _throw(ErrnoError.With('ENOENT', parentPath, syscall)));

		// Check if file already exists.
		if (listing[fname]) throw ErrnoError.With('EEXIST', path, syscall);

		const id = this.allocNew(path, syscall);

		// Commit data.
		const inode = new Inode({
			ino: id,
			data: id + 1,
			mode: options.mode,
			size: data.byteLength,
			uid: parent.mode & S_ISUID ? parent.uid : options.uid,
			gid: parent.mode & S_ISGID ? parent.gid : options.gid,
		});

		// Update and commit parent directory listing.
		tx.setSync(inode.ino, serialize(inode));
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
	 * @todo Update mtime.
	 */
	protected async remove(path: string, isDir: boolean): Promise<void> {
		const syscall = isDir ? 'rmdir' : 'unlink';
		await using tx = this.transaction();

		const { dir: parent, base: fileName } = parse(path),
			parentNode = await this.findInode(tx, parent, syscall),
			listing = decodeDirListing((await tx.get(parentNode.data)) ?? _throw(ErrnoError.With('ENOENT', parent, syscall)));

		if (!listing[fileName]) {
			throw ErrnoError.With('ENOENT', path, syscall);
		}

		const fileIno = listing[fileName];

		// Get file inode.
		const fileNode = new Inode((await tx.get(fileIno)) ?? _throw(ErrnoError.With('ENOENT', path, syscall)));

		// Remove from directory listing of parent.
		delete listing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) throw ErrnoError.With('EISDIR', path, syscall);

		await tx.set(parentNode.data, encodeDirListing(listing));

		if (--fileNode.nlink < 1) {
			// remove file
			await tx.remove(fileNode.data);
			await tx.remove(fileIno);
			this._remove(fileIno);
		}

		// Success.
		await tx.commit();
	}

	/**
	 * Remove all traces of `path` from the file system.
	 * @param path The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	protected removeSync(path: string, isDir: boolean): void {
		const syscall = isDir ? 'rmdir' : 'unlink';
		using tx = this.transaction();
		const { dir: parent, base: fileName } = parse(path),
			parentNode = this.findInodeSync(tx, parent, syscall),
			listing = decodeDirListing(tx.getSync(parentNode.data) ?? _throw(ErrnoError.With('ENOENT', parent, syscall))),
			fileIno: number = listing[fileName];

		if (!fileIno) throw ErrnoError.With('ENOENT', path, syscall);

		// Get file inode.
		const fileNode = new Inode(tx.getSync(fileIno) ?? _throw(ErrnoError.With('ENOENT', path, syscall)));

		// Remove from directory listing of parent.
		delete listing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('EISDIR', path, syscall);
		}

		// Update directory listing.
		tx.setSync(parentNode.data, encodeDirListing(listing));

		if (--fileNode.nlink < 1) {
			// remove file
			tx.removeSync(fileNode.data);
			tx.removeSync(fileIno);
			this._remove(fileIno);
		}

		// Success.
		tx.commitSync();
	}
}
