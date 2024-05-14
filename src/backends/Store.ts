import { Cred } from '../cred.js';
import { R_OK, W_OK } from '../emulation/constants.js';
import { basename, dirname, join, resolve, sep } from '../emulation/path.js';
import { Errno, ErrnoError } from '../error.js';
import { PreloadFile, flagToMode } from '../file.js';
import { FileSystem, type FileSystemMetadata } from '../filesystem.js';
import { Inode, randomIno, rootIno, type Ino } from '../inode.js';
import { FileType, type Stats } from '../stats.js';
import { decodeDirListing, encode, encodeDirListing } from '../utils.js';

/**
 * Represents a key-value store.
 */
export interface Store {
	/**
	 * The name of the key-value store.
	 */
	name: string;

	/**
	 * Temporary. Flag used to determine whether to
	 * A. initialize the store in the StoreFS constructor (sync)
	 * or B. initialize the store in StoreFS.ready (async)
	 */
	isSync: boolean;

	/**
	 * Empties the store completely.
	 */
	clear(): Promise<void> | void;

	/**
	 * Empties the key-value store completely.
	 */
	clearSync(): void;

	/**
	 * Begins a new transaction.
	 */
	beginTransaction(): Transaction;
}

/**
 * A transaction for a synchronous key value store.
 */
export interface Transaction {
	/**
	 * Retrieves the data at the given key.
	 * @param ino The key to look under for data.
	 */
	get(ino: Ino): Promise<Uint8Array>;

	/**
	 * Retrieves the data at the given key. Throws an error if an error occurs
	 * or if the key does not exist.
	 * @param ino The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	getSync(ino: Ino): Uint8Array | void;

	/**
	 * Adds the data to the store under the given key. Overwrites any existing
	 * data.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids writing the data if the key exists.
	 */
	put(ino: Ino, data: Uint8Array, overwrite: boolean): Promise<boolean>;

	/**
	 * Adds the data to the store under the given key.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids storing the data if the key exists.
	 * @return True if storage succeeded, false otherwise.
	 */
	putSync(ino: Ino, data: Uint8Array, overwrite: boolean): boolean;

	/**
	 * Deletes the data at the given key.
	 * @param ino The key to delete from the store.
	 */
	remove(ino: Ino): Promise<void>;

	/**
	 * Deletes the data at the given key.
	 * @param ino The key to delete from the store.
	 */
	removeSync(ino: Ino): void;

	/**
	 * Commits the transaction.
	 */
	commit(): Promise<void>;

	/**
	 * Commits the transaction.
	 */
	commitSync(): void;

	/**
	 * Aborts and rolls back the transaction.
	 */
	abort(): Promise<void>;

	/**
	 * Aborts and rolls back the transaction.
	 */
	abortSync(): void;
}

export abstract class SyncTransaction implements Transaction {
	public abstract getSync(ino: Ino): Uint8Array;
	public async get(ino: Ino): Promise<Uint8Array> {
		return this.getSync(ino);
	}
	public abstract putSync(ino: bigint, data: Uint8Array, overwrite: boolean): boolean;
	public async put(ino: bigint, data: Uint8Array, overwrite: boolean): Promise<boolean> {
		return this.putSync(ino, data, overwrite);
	}
	public abstract removeSync(ino: bigint): void;
	public async remove(ino: Ino): Promise<void> {
		return this.removeSync(ino);
	}
	public abstract commitSync(): void;
	public async commit(): Promise<void> {
		return this.commitSync();
	}
	public abstract abortSync(): void;
	public async abort(): Promise<void> {
		return this.abortSync();
	}
}

export abstract class AsyncTransaction implements Transaction {
	public getSync(ino: Ino): Uint8Array | void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.getSync');
	}
	public abstract get(key: bigint): Promise<Uint8Array>;
	public putSync(ino: bigint, data: Uint8Array, overwrite: boolean): boolean {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.putSync');
	}
	public abstract put(key: bigint, data: Uint8Array, overwrite: boolean): Promise<boolean>;
	public removeSync(ino: bigint): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.removeSync');
	}
	public abstract remove(key: bigint): Promise<void>;
	public commitSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.commitSync');
	}
	public abstract commit(): Promise<void>;
	public abortSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'AsyncTransaction.abortSync');
	}
	public abstract abort(): Promise<void>;
}

/**
 * An interface for simple synchronous key-value stores that don't have special
 * support for transactions and such.
 */
export interface SimpleSyncStore {
	get(ino: Ino): Uint8Array | undefined;
	put(ino: Ino, data: Uint8Array, overwrite: boolean): boolean;
	remove(ino: Ino): void;
}

/**
 * A simple transaction for simple synchronous key-value stores.
 */
export class SimpleSyncTransaction extends SyncTransaction {
	/**
	 * Stores data in the keys we modify prior to modifying them.
	 * Allows us to roll back commits.
	 */
	protected originalData: Map<Ino, Uint8Array | void> = new Map();
	/**
	 * List of keys modified in this transaction, if any.
	 */
	protected modifiedKeys: Set<Ino> = new Set();

	constructor(protected store: SimpleSyncStore) {
		super();
	}

	public getSync(ino: Ino): Uint8Array {
		const val = this.store.get(ino);
		this.stashOldValue(ino, val);
		return val!;
	}

	public putSync(ino: Ino, data: Uint8Array, overwrite: boolean): boolean {
		this.markModified(ino);
		return this.store.put(ino, data, overwrite);
	}

	public removeSync(ino: Ino): void {
		this.markModified(ino);
		this.store.remove(ino);
	}

	public commitSync(): void {
		/* NOP */
	}

	public abortSync(): void {
		// Rollback old values.
		for (const key of this.modifiedKeys) {
			const value = this.originalData.get(key);
			if (!value) {
				// Key didn't exist.
				this.store.remove(key);
			} else {
				// Key existed. Store old value.
				this.store.put(key, value, true);
			}
		}
	}

	/**
	 * Stashes given key value pair into `originalData` if it doesn't already
	 * exist. Allows us to stash values the program is requesting anyway to
	 * prevent needless `get` requests if the program modifies the data later
	 * on during the transaction.
	 */
	protected stashOldValue(ino: Ino, value?: Uint8Array): void {
		// Keep only the earliest value in the transaction.
		if (!this.originalData.has(ino)) {
			this.originalData.set(ino, value);
		}
	}

	/**
	 * Marks the given key as modified, and stashes its value if it has not been
	 * stashed already.
	 */
	protected markModified(ino: Ino): void {
		this.modifiedKeys.add(ino);
		if (!this.originalData.has(ino)) {
			this.originalData.set(ino, this.store.get(ino));
		}
	}
}

export interface StoreOptions {
	/**
	 * The actual key-value store to read from/write to.
	 */
	store: Store | Promise<Store>;
}

/**
 * A synchronous key-value file system. Uses a SyncStore to store the data.
 *
 * We use a unique ID for each node in the file system. The root node has a fixed ID.
 * @todo Introduce Node ID caching.
 * @todo Check modes.
 * @internal
 */
export class StoreFS extends FileSystem {
	protected get store(): Store {
		if (!this._store) {
			throw new ErrnoError(Errno.ENODATA, 'No store attached');
		}
		return this._store;
	}

	protected _store?: Store;

	private _initialized: boolean = false;

	public async ready(): Promise<this> {
		await super.ready();
		if (this._initialized) {
			return this;
		}
		this._initialized = true;
		this._store = await this.options.store;
		await this.makeRootDirectory();
		return this;
	}

	constructor(protected options: StoreOptions) {
		super();

		if (!(options.store instanceof Promise) && options.store.isSync) {
			this._store = options.store;
			this._initialized = true;

			this.makeRootDirectorySync();
		}
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: this.store.name,
		};
	}

	/**
	 * Delete all contents stored in the file system.
	 */
	public async empty(): Promise<void> {
		await this.store.clearSync();
		// Root always exists.
		await this.makeRootDirectory();
	}

	/**
	 * Delete all contents stored in the file system.
	 */
	public emptySync(): void {
		this.store.clearSync();
		// Root always exists.
		this.makeRootDirectorySync();
	}

	/**
	 * @todo Make rename compatible with the cache.
	 */
	public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		const tx = this.store.beginTransaction(),
			oldParent = dirname(oldPath),
			oldName = basename(oldPath),
			newParent = dirname(newPath),
			newName = basename(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = await this.findINode(tx, oldParent),
			oldDirList = await this.getDirListing(tx, oldDirNode, oldParent);

		if (!oldDirNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', oldPath, 'rename');
		}

		if (!oldDirList[oldName]) {
			throw ErrnoError.With('ENOENT', oldPath, 'rename');
		}
		const nodeId: Ino = oldDirList[oldName];
		delete oldDirList[oldName];

		// Invariant: Can't move a folder inside itself.
		// This funny little hack ensures that the check passes only if oldPath
		// is a subpath of newParent. We append '/' to avoid matching folders that
		// are a substring of the bottom-most folder in the path.
		if ((newParent + '/').indexOf(oldPath + '/') === 0) {
			throw new ErrnoError(Errno.EBUSY, oldParent);
		}

		// Add newPath to parent's directory listing.
		let newDirNode: Inode, newDirList: typeof oldDirList;
		if (newParent === oldParent) {
			// Prevent us from re-grabbing the same directory listing, which still
			// contains oldName.
			newDirNode = oldDirNode;
			newDirList = oldDirList;
		} else {
			newDirNode = await this.findINode(tx, newParent);
			newDirList = await this.getDirListing(tx, newDirNode, newParent);
		}

		if (newDirList[newName]) {
			// If it's a file, delete it.
			const newNameNode = await this.getINode(tx, newDirList[newName], newPath);
			if (newNameNode.toStats().isFile()) {
				try {
					await tx.remove(newNameNode.ino);
					await tx.remove(newDirList[newName]);
				} catch (e) {
					await tx.abort();
					throw e;
				}
			} else {
				// If it's a directory, throw a permissions error.
				throw ErrnoError.With('EPERM', newPath, 'rename');
			}
		}
		newDirList[newName] = nodeId;
		// Commit the two changed directory listings.
		try {
			await tx.put(oldDirNode.ino, encodeDirListing(oldDirList), true);
			await tx.put(newDirNode.ino, encodeDirListing(newDirList), true);
		} catch (e) {
			await tx.abort();
			throw e;
		}

		await tx.commit();
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		const tx = this.store.beginTransaction(),
			oldParent = dirname(oldPath),
			oldName = basename(oldPath),
			newParent = dirname(newPath),
			newName = basename(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = this.findINodeSync(tx, oldParent),
			oldDirList = this.getDirListingSync(tx, oldDirNode, oldParent);

		if (!oldDirNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', oldPath, 'rename');
		}

		if (!oldDirList[oldName]) {
			throw ErrnoError.With('ENOENT', oldPath, 'rename');
		}
		const ino: Ino = oldDirList[oldName];
		delete oldDirList[oldName];

		// Invariant: Can't move a folder inside itself.
		// This funny little hack ensures that the check passes only if oldPath
		// is a subpath of newParent. We append '/' to avoid matching folders that
		// are a substring of the bottom-most folder in the path.
		if ((newParent + '/').indexOf(oldPath + '/') == 0) {
			throw new ErrnoError(Errno.EBUSY, oldParent);
		}

		// Add newPath to parent's directory listing.
		let newDirNode: Inode, newDirList: typeof oldDirList;
		if (newParent === oldParent) {
			// Prevent us from re-grabbing the same directory listing, which still
			// contains oldName.
			newDirNode = oldDirNode;
			newDirList = oldDirList;
		} else {
			newDirNode = this.findINodeSync(tx, newParent);
			newDirList = this.getDirListingSync(tx, newDirNode, newParent);
		}

		if (newDirList[newName]) {
			// If it's a file, delete it.
			const newNameNode = this.getINodeSync(tx, newDirList[newName], newPath);
			if (newNameNode.toStats().isFile()) {
				try {
					tx.removeSync(newNameNode.ino);
					tx.removeSync(newDirList[newName]);
				} catch (e) {
					tx.abortSync();
					throw e;
				}
			} else {
				// If it's a directory, throw a permissions error.
				throw ErrnoError.With('EPERM', newPath, 'rename');
			}
		}
		newDirList[newName] = ino;

		// Commit the two changed directory listings.
		try {
			tx.putSync(oldDirNode.ino, encodeDirListing(oldDirList), true);
			tx.putSync(newDirNode.ino, encodeDirListing(newDirList), true);
		} catch (e) {
			tx.abortSync();
			throw e;
		}

		tx.commitSync();
	}

	public async stat(p: string, cred: Cred): Promise<Stats> {
		const tx = this.store.beginTransaction();
		const inode = await this.findINode(tx, p);
		if (!inode) {
			throw ErrnoError.With('ENOENT', p, 'stat');
		}
		const stats = inode.toStats();
		if (!stats.hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', p, 'stat');
		}
		return stats;
	}

	public statSync(p: string, cred: Cred): Stats {
		// Get the inode to the item, convert it into a Stats object.
		const stats = this.findINodeSync(this.store.beginTransaction(), p).toStats();
		if (!stats.hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', p, 'stat');
		}
		return stats;
	}

	public async createFile(p: string, flag: string, mode: number, cred: Cred): Promise<PreloadFile<this>> {
		const tx = this.store.beginTransaction(),
			data = new Uint8Array(0),
			newFile = await this.commitNewFile(tx, p, FileType.FILE, mode, cred, data);
		// Open the file.
		return new PreloadFile(this, p, flag, newFile.toStats(), data);
	}

	public createFileSync(p: string, flag: string, mode: number, cred: Cred): PreloadFile<this> {
		this.commitNewFileSync(p, FileType.FILE, mode, cred);
		return this.openFileSync(p, flag, cred);
	}

	public async openFile(p: string, flag: string, cred: Cred): Promise<PreloadFile<this>> {
		const tx = this.store.beginTransaction(),
			node = await this.findINode(tx, p),
			data = await tx.get(node.ino);
		if (!node.toStats().hasAccess(flagToMode(flag), cred)) {
			throw ErrnoError.With('EACCES', p, 'openFile');
		}
		if (!data) {
			throw ErrnoError.With('ENOENT', p, 'openFile');
		}
		return new PreloadFile(this, p, flag, node.toStats(), data);
	}

	public openFileSync(p: string, flag: string, cred: Cred): PreloadFile<this> {
		const tx = this.store.beginTransaction(),
			node = this.findINodeSync(tx, p),
			data = tx.getSync(node.ino);
		if (!node.toStats().hasAccess(flagToMode(flag), cred)) {
			throw ErrnoError.With('EACCES', p, 'openFile');
		}
		if (!data) {
			throw ErrnoError.With('ENOENT', p, 'openFile');
		}
		return new PreloadFile(this, p, flag, node.toStats(), data);
	}

	public async unlink(p: string, cred: Cred): Promise<void> {
		return this.removeEntry(p, false, cred);
	}

	public unlinkSync(p: string, cred: Cred): void {
		this.removeEntrySync(p, false, cred);
	}

	public async rmdir(p: string, cred: Cred): Promise<void> {
		// Check first if directory is empty.
		const list = await this.readdir(p, cred);
		if (list.length > 0) {
			throw ErrnoError.With('ENOTEMPTY', p, 'rmdir');
		}
		await this.removeEntry(p, true, cred);
	}

	public rmdirSync(p: string, cred: Cred): void {
		// Check first if directory is empty.
		if (this.readdirSync(p, cred).length > 0) {
			throw ErrnoError.With('ENOTEMPTY', p, 'rmdir');
		} else {
			this.removeEntrySync(p, true, cred);
		}
	}

	public async mkdir(p: string, mode: number, cred: Cred): Promise<void> {
		const tx = this.store.beginTransaction(),
			data = encode('{}');
		await this.commitNewFile(tx, p, FileType.DIRECTORY, mode, cred, data);
	}

	public mkdirSync(p: string, mode: number, cred: Cred): void {
		this.commitNewFileSync(p, FileType.DIRECTORY, mode, cred, encode('{}'));
	}

	public async readdir(p: string, cred: Cred): Promise<string[]> {
		const tx = this.store.beginTransaction();
		const node = await this.findINode(tx, p);
		if (!node.toStats().hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', p, 'readdur');
		}
		return Object.keys(await this.getDirListing(tx, node, p));
	}

	public readdirSync(p: string, cred: Cred): string[] {
		const tx = this.store.beginTransaction();
		const node = this.findINodeSync(tx, p);
		if (!node.toStats().hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', p, 'readdir');
		}
		return Object.keys(this.getDirListingSync(tx, node, p));
	}

	/**
	 * Updated the inode and data node at the given path
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public async sync(p: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		const tx = this.store.beginTransaction(),
			// We use the _findInode helper because we actually need the INode id.
			fileInodeId = await this._findINode(tx, dirname(p), basename(p)),
			fileInode = await this.getINode(tx, fileInodeId, p),
			inodeChanged = fileInode.update(stats);

		try {
			// Sync data.
			await tx.put(fileInode.ino, data, true);
			// Sync metadata.
			if (inodeChanged) {
				await tx.put(fileInodeId, fileInode.data, true);
			}
		} catch (e) {
			await tx.abort();
			throw e;
		}
		await tx.commit();
	}

	public syncSync(p: string, data: Uint8Array, stats: Readonly<Stats>): void {
		// @todo Ensure mtime updates properly, and use that to determine if a data
		//       update is required.
		const tx = this.store.beginTransaction(),
			// We use the _findInode helper because we actually need the INode id.
			fileInodeId = this._findINodeSync(tx, dirname(p), basename(p)),
			fileInode = this.getINodeSync(tx, fileInodeId, p),
			inodeChanged = fileInode.update(stats);

		try {
			// Sync data.
			tx.putSync(fileInode.ino, data, true);
			// Sync metadata.
			if (inodeChanged) {
				tx.putSync(fileInodeId, fileInode.data, true);
			}
		} catch (e) {
			tx.abortSync();
			throw e;
		}
		tx.commitSync();
	}

	public async link(existing: string, newpath: string, cred: Cred): Promise<void> {
		const tx = this.store.beginTransaction(),
			existingDir: string = dirname(existing),
			existingDirNode = await this.findINode(tx, existingDir);

		if (!existingDirNode.toStats().hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', existingDir, 'link');
		}

		const newDir: string = dirname(newpath),
			newDirNode = await this.findINode(tx, newDir),
			newListing = await this.getDirListing(tx, newDirNode, newDir);

		if (!newDirNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', newDir, 'link');
		}

		const ino = await this._findINode(tx, existingDir, basename(existing));
		const node = await this.getINode(tx, ino, existing);

		if (!node.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', newpath, 'link');
		}

		node.nlink++;
		newListing[basename(newpath)] = ino;
		try {
			tx.putSync(ino, node.data, true);
			tx.putSync(newDirNode.ino, encodeDirListing(newListing), true);
		} catch (e) {
			tx.abortSync();
			throw e;
		}
		tx.commitSync();
	}

	public linkSync(existing: string, newpath: string, cred: Cred): void {
		const tx = this.store.beginTransaction(),
			existingDir: string = dirname(existing),
			existingDirNode = this.findINodeSync(tx, existingDir);

		if (!existingDirNode.toStats().hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', existingDir, 'link');
		}

		const newDir: string = dirname(newpath),
			newDirNode = this.findINodeSync(tx, newDir),
			newListing = this.getDirListingSync(tx, newDirNode, newDir);

		if (!newDirNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', newDir, 'link');
		}

		const ino = this._findINodeSync(tx, existingDir, basename(existing));
		const node = this.getINodeSync(tx, ino, existing);

		if (!node.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', newpath, 'link');
		}
		node.nlink++;
		newListing[basename(newpath)] = ino;
		try {
			tx.putSync(ino, node.data, true);
			tx.putSync(newDirNode.ino, encodeDirListing(newListing), true);
		} catch (e) {
			tx.abortSync();
			throw e;
		}
		tx.commitSync();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	private async makeRootDirectory(): Promise<void> {
		const tx = this.store.beginTransaction();
		if (!(await tx.get(rootIno))) {
			// Create new inode. o777, owned by root:root
			const inode = new Inode();
			inode.mode = 0o777 | FileType.DIRECTORY;
			// If the root doesn't exist, the first random ID shouldn't exist either.
			await tx.put(inode.ino, encode('{}'), false);
			await tx.put(rootIno, inode.data, false);
			await tx.commit();
		}
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	protected makeRootDirectorySync(): void {
		const tx = this.store.beginTransaction();
		if (tx.getSync(rootIno)) {
			return;
		}
		// Create new inode, mode o777, owned by root:root
		const inode = new Inode();
		inode.mode = 0o777 | FileType.DIRECTORY;
		// If the root doesn't exist, the first random ID shouldn't exist either.
		tx.putSync(inode.ino, encode('{}'), false);
		tx.putSync(rootIno, inode.data, false);
		tx.commitSync();
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 */
	private async _findINode(tx: Transaction, parent: string, filename: string, visited: Set<string> = new Set<string>()): Promise<Ino> {
		const currentPath = join(parent, filename);
		if (visited.has(currentPath)) {
			throw new ErrnoError(Errno.EIO, 'Infinite loop detected while finding inode', currentPath);
		}

		visited.add(currentPath);

		if (parent === '/') {
			if (filename === '') {
				return rootIno;
			} else {
				// BASE CASE #2: Find the item in the root node.
				const inode = await this.getINode(tx, rootIno, parent);
				const dirList = await this.getDirListing(tx, inode!, parent);
				if (dirList![filename]) {
					const id = dirList![filename];
					return id;
				} else {
					throw ErrnoError.With('ENOENT', resolve(parent, filename), '_findINode');
				}
			}
		} else {
			// Get the parent directory's INode, and find the file in its directory
			// listing.
			const inode = await this.findINode(tx, parent, visited);
			const dirList = await this.getDirListing(tx, inode!, parent);
			if (dirList![filename]) {
				const id = dirList![filename];
				return id;
			} else {
				throw ErrnoError.With('ENOENT', resolve(parent, filename), '_findINode');
			}
		}
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 * @return string The ID of the file's inode in the file system.
	 */
	protected _findINodeSync(tx: Transaction, parent: string, filename: string, visited: Set<string> = new Set()): Ino {
		const currentPath = join(parent, filename);
		if (visited.has(currentPath)) {
			throw new ErrnoError(Errno.EIO, 'Infinite loop detected while finding inode', currentPath);
		}

		visited.add(currentPath);

		if (parent != '/') {
			const ino = this._findINodeSync(tx, dirname(parent), basename(parent), visited);
			const dir = this.getDirListingSync(tx, this.getINodeSync(tx, ino, parent + sep + filename), parent);
			if (!(filename in dir)) {
				throw ErrnoError.With('ENOENT', resolve(parent, filename), '_findINode');
			}

			return dir[filename];
		}

		if (filename != '') {
			// Find the item in the root node.
			const dir = this.getDirListingSync(tx, this.getINodeSync(tx, rootIno, parent), parent);
			if (!(filename in dir)) {
				throw ErrnoError.With('ENOENT', resolve(parent, filename), '_findINode');
			}
			return dir[filename];
		}

		// Return the root's ID.
		return rootIno;
	}

	/**
	 * Finds the Inode of the given path.
	 * @param p The path to look up.
	 * @todo memoize/cache
	 */
	private async findINode(tx: Transaction, p: string, visited: Set<string> = new Set<string>()): Promise<Inode> {
		const id = await this._findINode(tx, dirname(p), basename(p), visited);
		return this.getINode(tx, id!, p);
	}

	/**
	 * Finds the Inode of the given path.
	 * @param p The path to look up.
	 * @return The Inode of the path p.
	 * @todo memoize/cache
	 */
	protected findINodeSync(tx: Transaction, p: string): Inode {
		const ino = this._findINodeSync(tx, dirname(p), basename(p));
		return this.getINodeSync(tx, ino, p);
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param p The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	private async getINode(tx: Transaction, id: Ino, p: string): Promise<Inode> {
		const data = await tx.get(id);
		if (!data) {
			throw ErrnoError.With('ENOENT', p, 'getINode');
		}
		return new Inode(data.buffer);
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param path The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	protected getINodeSync(tx: Transaction, id: Ino, path?: string): Inode {
		const data = tx.getSync(id);
		if (!data) {
			throw ErrnoError.With('ENOENT', path, 'getINode');
		}
		const inode = new Inode(data.buffer);
		return inode;
	}

	/**
	 * Given the Inode of a directory, retrieves the corresponding directory
	 * listing.
	 */
	private async getDirListing(tx: Transaction, inode: Inode, p: string): Promise<{ [fileName: string]: Ino }> {
		if (!inode.toStats().isDirectory()) {
			throw ErrnoError.With('ENOTDIR', p, 'getDirListing');
		}
		const data = await tx.get(inode.ino);
		if (!data) {
			/*
				Occurs when data is undefined, or corresponds to something other
				than a directory listing. The latter should never occur unless
				the file system is corrupted.
			 */
			throw ErrnoError.With('ENOENT', p, 'getDirListing');
		}

		return decodeDirListing(data);
	}

	/**
	 * Given the Inode of a directory, retrieves the corresponding directory listing.
	 */
	protected getDirListingSync(tx: Transaction, inode: Inode, p?: string): { [fileName: string]: Ino } {
		if (!inode.toStats().isDirectory()) {
			throw ErrnoError.With('ENOTDIR', p, 'getDirListing');
		}
		const data = tx.getSync(inode.ino);
		if (!data) {
			throw ErrnoError.With('ENOENT', p, 'getDirListing');
		}
		return decodeDirListing(data);
	}

	/**
	 * Adds a new node under a random ID. Retries 5 times before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random ino.
	 */
	private async addNewNode(tx: Transaction, data: Uint8Array, _maxAttempts: number = 5): Promise<Ino> {
		if (_maxAttempts <= 0) {
			// Max retries hit. Return with an error.
			throw new ErrnoError(Errno.EIO, 'Unable to commit data to key-value store.');
		}
		// Make an attempt
		const ino = randomIno();
		const isCommited = await tx.put(ino, data, false);
		if (!isCommited) {
			return await this.addNewNode(tx, data, --_maxAttempts);
		}

		return ino;
	}

	/**
	 * Creates a new node under a random ID. Retries 5 times before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random GUID.
	 * @return The GUID that the data was stored under.
	 */
	protected addNewNodeSync(tx: Transaction, data: Uint8Array, _maxAttempts: number = 5): Ino {
		for (let i = 0; i < _maxAttempts; i++) {
			const ino: Ino = randomIno();
			if (!tx.putSync(ino, data, false)) {
				continue;
			}
			return ino;
		}
		throw new ErrnoError(Errno.EIO, 'Unable to commit data to key-value store.');
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with
	 * the given mode.
	 * Note: This will commit the transaction.
	 * @param p The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param cred The UID/GID to create the file with
	 * @param data The data to store at the file's data node.
	 */
	private async commitNewFile(tx: Transaction, p: string, type: FileType, mode: number, cred: Cred, data: Uint8Array): Promise<Inode> {
		const parentDir = dirname(p),
			fname = basename(p),
			parentNode = await this.findINode(tx, parentDir),
			dirListing = await this.getDirListing(tx, parentNode, parentDir);

		//Check that the creater has correct access
		if (!parentNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', p, 'commitNewFile');
		}

		// Invariant: The root always exists.
		// If we don't check this prior to taking steps below, we will create a
		// file with name '' in root should p == '/'.
		if (p === '/') {
			throw ErrnoError.With('EEXIST', p, 'commitNewFile');
		}

		// Check if file already exists.
		if (dirListing[fname]) {
			await tx.abort();
			throw ErrnoError.With('EEXIST', p, 'commitNewFile');
		}
		try {
			// Commit data.

			const inode = new Inode();
			inode.ino = await this.addNewNode(tx, data);
			inode.mode = mode | type;
			inode.uid = cred.uid;
			inode.gid = cred.gid;
			inode.size = data.length;

			// Update and commit parent directory listing.
			dirListing[fname] = await this.addNewNode(tx, inode.data);
			await tx.put(parentNode.ino, encodeDirListing(dirListing), true);
			await tx.commit();
			return inode;
		} catch (e) {
			tx.abort();
			throw e;
		}
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with the given mode.
	 * Note: This will commit the transaction.
	 * @param p The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param data The data to store at the file's data node.
	 * @return The Inode for the new file.
	 */
	protected commitNewFileSync(p: string, type: FileType, mode: number, cred: Cred, data: Uint8Array = new Uint8Array()): Inode {
		const tx = this.store.beginTransaction(),
			parentDir = dirname(p),
			fname = basename(p),
			parentNode = this.findINodeSync(tx, parentDir),
			dirListing = this.getDirListingSync(tx, parentNode, parentDir);

		//Check that the creater has correct access
		if (!parentNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', p, 'commitNewFile');
		}

		/* Invariant: The root always exists.
		If we don't check this prior to taking steps below,
		we will create a file with name '' in root should p == '/'.
		*/
		if (p === '/') {
			throw ErrnoError.With('EEXIST', p, 'commitNewFile');
		}

		// Check if file already exists.
		if (dirListing[fname]) {
			throw ErrnoError.With('EEXIST', p, 'commitNewFile');
		}

		const fileNode = new Inode();
		try {
			// Commit data.
			fileNode.ino = this.addNewNodeSync(tx, data);
			fileNode.size = data.length;
			fileNode.mode = mode | type;
			fileNode.uid = cred.uid;
			fileNode.gid = cred.gid;
			// Update and commit parent directory listing.
			dirListing[fname] = this.addNewNodeSync(tx, fileNode.data);
			tx.putSync(parentNode.ino, encodeDirListing(dirListing), true);
		} catch (e) {
			tx.abortSync();
			throw e;
		}
		tx.commitSync();
		return fileNode;
	}

	/**
	 * Remove all traces of the given path from the file system.
	 * @param p The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	private async removeEntry(p: string, isDir: boolean, cred: Cred): Promise<void> {
		const tx = this.store.beginTransaction(),
			parent: string = dirname(p),
			parentNode = await this.findINode(tx, parent),
			parentListing = await this.getDirListing(tx, parentNode, parent),
			fileName: string = basename(p);

		if (!parentListing[fileName]) {
			throw ErrnoError.With('ENOENT', p, 'removeEntry');
		}

		const fileIno = parentListing[fileName];

		// Get file inode.
		const fileNode = await this.getINode(tx, fileIno, p);

		if (!fileNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', p, 'removeEntry');
		}

		// Remove from directory listing of parent.
		delete parentListing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('EISDIR', p, 'removeEntry');
		}

		if (isDir && !fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('ENOTDIR', p, 'removeEntry');
		}

		try {
			await tx.put(parentNode.ino, encodeDirListing(parentListing), true);

			if (--fileNode.nlink < 1) {
				// remove file
				await tx.remove(fileNode.ino);
				await tx.remove(fileIno);
			}
		} catch (e) {
			await tx.abort();
			throw e;
		}

		// Success.
		await tx.commit();
	}

	/**
	 * Remove all traces of the given path from the file system.
	 * @param p The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	protected removeEntrySync(p: string, isDir: boolean, cred: Cred): void {
		const tx = this.store.beginTransaction(),
			parent: string = dirname(p),
			parentNode = this.findINodeSync(tx, parent),
			parentListing = this.getDirListingSync(tx, parentNode, parent),
			fileName: string = basename(p),
			fileIno: Ino = parentListing[fileName];

		if (!fileIno) {
			throw ErrnoError.With('ENOENT', p, 'removeEntry');
		}

		// Get file inode.
		const fileNode = this.getINodeSync(tx, fileIno, p);

		if (!fileNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', p, 'removeEntry');
		}

		// Remove from directory listing of parent.
		delete parentListing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('EISDIR', p, 'removeEntry');
		}

		if (isDir && !fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('ENOTDIR', p, 'removeEntry');
		}

		try {
			// Update directory listing.
			tx.putSync(parentNode.ino, encodeDirListing(parentListing), true);

			if (--fileNode.nlink < 1) {
				// remove file
				tx.removeSync(fileNode.ino);
				tx.removeSync(fileIno);
			}
		} catch (e) {
			tx.abortSync();
			throw e;
		}
		// Success.
		tx.commitSync();
	}
}
