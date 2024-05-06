import { dirname, basename, join, resolve, sep } from '../emulation/path.js';
import { ApiError, ErrorCode } from '../ApiError.js';
import { Cred } from '../cred.js';
import { W_OK, R_OK } from '../emulation/constants.js';
import { PreloadFile, flagToMode } from '../file.js';
import { type FileSystemMetadata, FileSystem, Sync } from '../filesystem.js';
import { randomIno, type Ino, Inode } from '../inode.js';
import { type Stats, FileType } from '../stats.js';
import { decodeDirListing, encode, encodeDirListing } from '../utils.js';
import { rootIno } from '../inode.js';

/**
 * Represents a *synchronous* key-value store.
 */
export interface SyncStore {
	/**
	 * The name of the key-value store.
	 */
	name: string;
	/**
	 * Empties the key-value store completely.
	 */
	clear(): void;
	/**
	 * Begins a new transaction.
	 */
	beginTransaction(): SyncTransaction;
}

/**
 * A transaction for a synchronous key value store.
 */
export interface SyncTransaction {
	/**
	 * Retrieves the data at the given key. Throws an ApiError if an error occurs
	 * or if the key does not exist.
	 * @param ino The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	get(ino: Ino): Uint8Array | void;

	/**
	 * Adds the data to the store under the given key.
	 * @param ino The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids storing the data if the key exists.
	 * @return True if storage succeeded, false otherwise.
	 */
	put(ino: Ino, data: Uint8Array, overwrite: boolean): boolean;
	/**
	 * Deletes the data at the given key.
	 * @param ino The key to delete from the store.
	 */
	remove(ino: Ino): void;
	/**
	 * Commits the transaction.
	 */
	commit(): void;
	/**
	 * Aborts and rolls back the transaction.
	 */
	abort(): void;
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
 * A simple RW transaction for simple synchronous key-value stores.
 */
export class SimpleSyncTransaction implements SyncTransaction {
	/**
	 * Stores data in the keys we modify prior to modifying them.
	 * Allows us to roll back commits.
	 */
	protected originalData: Map<Ino, Uint8Array | void> = new Map();
	/**
	 * List of keys modified in this transaction, if any.
	 */
	protected modifiedKeys: Set<Ino> = new Set();

	constructor(protected store: SimpleSyncStore) {}

	public get(ino: Ino): Uint8Array | void {
		const val = this.store.get(ino);
		this.stashOldValue(ino, val);
		return val;
	}

	public put(ino: Ino, data: Uint8Array, overwrite: boolean): boolean {
		this.markModified(ino);
		return this.store.put(ino, data, overwrite);
	}

	public remove(ino: Ino): void {
		this.markModified(ino);
		this.store.remove(ino);
	}

	public commit(): void {
		/* NOP */
	}

	public abort(): void {
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
	protected stashOldValue(ino: Ino, value?: Uint8Array) {
		// Keep only the earliest value in the transaction.
		if (!this.originalData.has(ino)) {
			this.originalData.set(ino, value);
		}
	}

	/**
	 * Marks the given key as modified, and stashes its value if it has not been
	 * stashed already.
	 */
	protected markModified(ino: Ino) {
		this.modifiedKeys.add(ino);
		if (!this.originalData.has(ino)) {
			this.originalData.set(ino, this.store.get(ino));
		}
	}
}

export interface SyncStoreOptions {
	/**
	 * The actual key-value store to read from/write to.
	 */
	store: SyncStore;
}

/**
 * A synchronous key-value file system. Uses a SyncStore to store the data.
 *
 * We use a unique ID for each node in the file system. The root node has a fixed ID.
 * @todo Introduce Node ID caching.
 * @todo Check modes.
 * @internal
 */
export class SyncStoreFS extends Sync(FileSystem) {
	protected store: SyncStore;

	constructor(options: SyncStoreOptions) {
		super();
		this.store = options.store;
		// INVARIANT: Ensure that the root exists.
		this.makeRootDirectory();
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
	public empty(): void {
		this.store.clear();
		// INVARIANT: Root always exists.
		this.makeRootDirectory();
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		const tx = this.store.beginTransaction(),
			oldParent = dirname(oldPath),
			oldName = basename(oldPath),
			newParent = dirname(newPath),
			newName = basename(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = this.findINode(tx, oldParent),
			oldDirList = this.getDirListing(tx, oldDirNode, oldParent);

		if (!oldDirNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.With('EACCES', oldPath, 'rename');
		}

		if (!oldDirList[oldName]) {
			throw ApiError.With('ENOENT', oldPath, 'rename');
		}
		const ino: Ino = oldDirList[oldName];
		delete oldDirList[oldName];

		// Invariant: Can't move a folder inside itself.
		// This funny little hack ensures that the check passes only if oldPath
		// is a subpath of newParent. We append '/' to avoid matching folders that
		// are a substring of the bottom-most folder in the path.
		if ((newParent + '/').indexOf(oldPath + '/') == 0) {
			throw new ApiError(ErrorCode.EBUSY, oldParent);
		}

		// Add newPath to parent's directory listing.
		let newDirNode: Inode, newDirList: typeof oldDirList;
		if (newParent === oldParent) {
			// Prevent us from re-grabbing the same directory listing, which still
			// contains oldName.
			newDirNode = oldDirNode;
			newDirList = oldDirList;
		} else {
			newDirNode = this.findINode(tx, newParent);
			newDirList = this.getDirListing(tx, newDirNode, newParent);
		}

		if (newDirList[newName]) {
			// If it's a file, delete it.
			const newNameNode = this.getINode(tx, newDirList[newName], newPath);
			if (newNameNode.toStats().isFile()) {
				try {
					tx.remove(newNameNode.ino);
					tx.remove(newDirList[newName]);
				} catch (e) {
					tx.abort();
					throw e;
				}
			} else {
				// If it's a directory, throw a permissions error.
				throw ApiError.With('EPERM', newPath, 'rename');
			}
		}
		newDirList[newName] = ino;

		// Commit the two changed directory listings.
		try {
			tx.put(oldDirNode.ino, encodeDirListing(oldDirList), true);
			tx.put(newDirNode.ino, encodeDirListing(newDirList), true);
		} catch (e) {
			tx.abort();
			throw e;
		}

		tx.commit();
	}

	public statSync(p: string, cred: Cred): Stats {
		// Get the inode to the item, convert it into a Stats object.
		const stats = this.findINode(this.store.beginTransaction(), p).toStats();
		if (!stats.hasAccess(R_OK, cred)) {
			throw ApiError.With('EACCES', p, 'stat');
		}
		return stats;
	}

	public createFileSync(p: string, flag: string, mode: number, cred: Cred): PreloadFile<this> {
		this.commitNewFile(p, FileType.FILE, mode, cred);
		return this.openFileSync(p, flag, cred);
	}

	public openFileSync(p: string, flag: string, cred: Cred): PreloadFile<this> {
		const tx = this.store.beginTransaction(),
			node = this.findINode(tx, p),
			data = tx.get(node.ino);
		if (!node.toStats().hasAccess(flagToMode(flag), cred)) {
			throw ApiError.With('EACCES', p, 'openFile');
		}
		if (!data) {
			throw ApiError.With('ENOENT', p, 'openFile');
		}
		return new PreloadFile(this, p, flag, node.toStats(), data);
	}

	public unlinkSync(p: string, cred: Cred): void {
		this.removeEntry(p, false, cred);
	}

	public rmdirSync(p: string, cred: Cred): void {
		// Check first if directory is empty.
		if (this.readdirSync(p, cred).length > 0) {
			throw ApiError.With('ENOTEMPTY', p, 'rmdir');
		} else {
			this.removeEntry(p, true, cred);
		}
	}

	public mkdirSync(p: string, mode: number, cred: Cred): void {
		this.commitNewFile(p, FileType.DIRECTORY, mode, cred, encode('{}'));
	}

	public readdirSync(p: string, cred: Cred): string[] {
		const tx = this.store.beginTransaction();
		const node = this.findINode(tx, p);
		if (!node.toStats().hasAccess(R_OK, cred)) {
			throw ApiError.With('EACCES', p, 'readdir');
		}
		return Object.keys(this.getDirListing(tx, node, p));
	}

	public syncSync(p: string, data: Uint8Array, stats: Readonly<Stats>): void {
		// @todo Ensure mtime updates properly, and use that to determine if a data
		//       update is required.
		const tx = this.store.beginTransaction(),
			// We use the _findInode helper because we actually need the INode id.
			fileInodeId = this._findINode(tx, dirname(p), basename(p)),
			fileInode = this.getINode(tx, fileInodeId, p),
			inodeChanged = fileInode.update(stats);

		try {
			// Sync data.
			tx.put(fileInode.ino, data, true);
			// Sync metadata.
			if (inodeChanged) {
				tx.put(fileInodeId, fileInode.data, true);
			}
		} catch (e) {
			tx.abort();
			throw e;
		}
		tx.commit();
	}

	public linkSync(existing: string, newpath: string, cred: Cred): void {
		const tx = this.store.beginTransaction(),
			existingDir: string = dirname(existing),
			existingDirNode = this.findINode(tx, existingDir);

		if (!existingDirNode.toStats().hasAccess(R_OK, cred)) {
			throw ApiError.With('EACCES', existingDir, 'link');
		}

		const newDir: string = dirname(newpath),
			newDirNode = this.findINode(tx, newDir),
			newListing = this.getDirListing(tx, newDirNode, newDir);

		if (!newDirNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.With('EACCES', newDir, 'link');
		}

		const ino = this._findINode(tx, existingDir, basename(existing));
		const node = this.getINode(tx, ino, existing);

		if (!node.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.With('EACCES', newpath, 'link');
		}
		node.nlink++;
		newListing[basename(newpath)] = ino;
		try {
			tx.put(ino, node.data, true);
			tx.put(newDirNode.ino, encodeDirListing(newListing), true);
		} catch (e) {
			tx.abort();
			throw e;
		}
		tx.commit();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	protected makeRootDirectory() {
		const tx = this.store.beginTransaction();
		if (tx.get(rootIno)) {
			return;
		}
		// Create new inode, mode o777, owned by root:root
		const inode = new Inode();
		inode.mode = 0o777 | FileType.DIRECTORY;
		// If the root doesn't exist, the first random ID shouldn't exist either.
		tx.put(inode.ino, encode('{}'), false);
		tx.put(rootIno, inode.data, false);
		tx.commit();
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 * @return string The ID of the file's inode in the file system.
	 */
	protected _findINode(tx: SyncTransaction, parent: string, filename: string, visited: Set<string> = new Set()): Ino {
		const currentPath = join(parent, filename);
		if (visited.has(currentPath)) {
			throw new ApiError(ErrorCode.EIO, 'Infinite loop detected while finding inode', currentPath);
		}

		visited.add(currentPath);

		if (parent != '/') {
			const ino = this._findINode(tx, dirname(parent), basename(parent), visited);
			const dir = this.getDirListing(tx, this.getINode(tx, ino, parent + sep + filename), parent);
			if (!(filename in dir)) {
				throw ApiError.With('ENOENT', resolve(parent, filename), '_findINode');
			}

			return dir[filename];
		}

		if (filename != '') {
			// Find the item in the root node.
			const dir = this.getDirListing(tx, this.getINode(tx, rootIno, parent), parent);
			if (!(filename in dir)) {
				throw ApiError.With('ENOENT', resolve(parent, filename), '_findINode');
			}
			return dir[filename];
		}

		// Return the root's ID.
		return rootIno;
	}

	/**
	 * Finds the Inode of the given path.
	 * @param p The path to look up.
	 * @return The Inode of the path p.
	 * @todo memoize/cache
	 */
	protected findINode(tx: SyncTransaction, p: string): Inode {
		const ino = this._findINode(tx, dirname(p), basename(p));
		return this.getINode(tx, ino, p);
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param path The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	protected getINode(tx: SyncTransaction, id: Ino, path?: string): Inode {
		const data = tx.get(id);
		if (!data) {
			throw ApiError.With('ENOENT', path, 'getINode');
		}
		const inode = new Inode(data.buffer);
		return inode;
	}

	/**
	 * Given the Inode of a directory, retrieves the corresponding directory listing.
	 */
	protected getDirListing(tx: SyncTransaction, inode: Inode, p?: string): { [fileName: string]: Ino } {
		if (!inode.toStats().isDirectory()) {
			throw ApiError.With('ENOTDIR', p, 'getDirListing');
		}
		const data = tx.get(inode.ino);
		if (!data) {
			throw ApiError.With('ENOENT', p, 'getDirListing');
		}
		return decodeDirListing(data);
	}

	/**
	 * Creates a new node under a random ID. Retries 5 times before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random GUID.
	 * @return The GUID that the data was stored under.
	 */
	protected addNewNode(tx: SyncTransaction, data: Uint8Array, _maxAttempts: number = 5): Ino {
		for (let i = 0; i < _maxAttempts; i++) {
			const ino: Ino = randomIno();
			if (!tx.put(ino, data, false)) {
				continue;
			}
			return ino;
		}
		throw new ApiError(ErrorCode.EIO, 'Unable to commit data to key-value store.');
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
	protected commitNewFile(p: string, type: FileType, mode: number, cred: Cred, data: Uint8Array = new Uint8Array()): Inode {
		const tx = this.store.beginTransaction(),
			parentDir = dirname(p),
			fname = basename(p),
			parentNode = this.findINode(tx, parentDir),
			dirListing = this.getDirListing(tx, parentNode, parentDir);

		//Check that the creater has correct access
		if (!parentNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.With('EACCES', p, 'commitNewFile');
		}

		/* Invariant: The root always exists.
		If we don't check this prior to taking steps below,
		we will create a file with name '' in root should p == '/'.
		*/
		if (p === '/') {
			throw ApiError.With('EEXIST', p, 'commitNewFile');
		}

		// Check if file already exists.
		if (dirListing[fname]) {
			throw ApiError.With('EEXIST', p, 'commitNewFile');
		}

		const fileNode = new Inode();
		try {
			// Commit data.
			fileNode.ino = this.addNewNode(tx, data);
			fileNode.size = data.length;
			fileNode.mode = mode | type;
			fileNode.uid = cred.uid;
			fileNode.gid = cred.gid;
			// Update and commit parent directory listing.
			dirListing[fname] = this.addNewNode(tx, fileNode.data);
			tx.put(parentNode.ino, encodeDirListing(dirListing), true);
		} catch (e) {
			tx.abort();
			throw e;
		}
		tx.commit();
		return fileNode;
	}

	/**
	 * Remove all traces of the given path from the file system.
	 * @param p The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	protected removeEntry(p: string, isDir: boolean, cred: Cred): void {
		const tx = this.store.beginTransaction(),
			parent: string = dirname(p),
			parentNode = this.findINode(tx, parent),
			parentListing = this.getDirListing(tx, parentNode, parent),
			fileName: string = basename(p),
			fileIno: Ino = parentListing[fileName];

		if (!fileIno) {
			throw ApiError.With('ENOENT', p, 'removeEntry');
		}

		// Get file inode.
		const fileNode = this.getINode(tx, fileIno, p);

		if (!fileNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.With('EACCES', p, 'removeEntry');
		}

		// Remove from directory listing of parent.
		delete parentListing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ApiError.With('EISDIR', p, 'removeEntry');
		}

		if (isDir && !fileNode.toStats().isDirectory()) {
			throw ApiError.With('ENOTDIR', p, 'removeEntry');
		}

		try {
			// Update directory listing.
			tx.put(parentNode.ino, encodeDirListing(parentListing), true);

			if (--fileNode.nlink < 1) {
				// remove file
				tx.remove(fileNode.ino);
				tx.remove(fileIno);
			}
		} catch (e) {
			tx.abort();
			throw e;
		}
		// Success.
		tx.commit();
	}
}
