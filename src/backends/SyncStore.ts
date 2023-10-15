import * as path from 'path';
import { ApiError, ErrorCode } from '../ApiError.js';
import { Cred } from '../cred.js';
import { W_OK, R_OK } from '../emulation/constants.js';
import { FileFlag, PreloadFile } from '../file.js';
import { SynchronousFileSystem } from '../filesystem.js';
import Inode from '../inode.js';
import { Stats, FileType } from '../stats.js';
import { randomUUID, getEmptyDirNode, ROOT_NODE_ID } from '../utils.js';

/**
 * Represents a *synchronous* key-value store.
 */
export interface SyncKeyValueStore {
	/**
	 * The name of the key-value store.
	 */
	name(): string;
	/**
	 * Empties the key-value store completely.
	 */
	clear(): void;
	/**
	 * Begins a new read-only transaction.
	 */
	beginTransaction(type: 'readonly'): SyncKeyValueROTransaction;
	/**
	 * Begins a new read-write transaction.
	 */
	beginTransaction(type: 'readwrite'): SyncKeyValueRWTransaction;
	beginTransaction(type: string): SyncKeyValueROTransaction;
}

/**
 * A read-only transaction for a synchronous key value store.
 */
export interface SyncKeyValueROTransaction {
	/**
	 * Retrieves the data at the given key. Throws an ApiError if an error occurs
	 * or if the key does not exist.
	 * @param key The key to look under for data.
	 * @return The data stored under the key, or undefined if not present.
	 */
	get(key: string): Buffer | undefined;
}

/**
 * A read-write transaction for a synchronous key value store.
 */
export interface SyncKeyValueRWTransaction extends SyncKeyValueROTransaction {
	/**
	 * Adds the data to the store under the given key.
	 * @param key The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids storing the data if the key exists.
	 * @return True if storage succeeded, false otherwise.
	 */
	put(key: string, data: Buffer, overwrite: boolean): boolean;
	/**
	 * Deletes the data at the given key.
	 * @param key The key to delete from the store.
	 */
	del(key: string): void;
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
	get(key: string): Buffer | undefined;
	put(key: string, data: Buffer, overwrite: boolean): boolean;
	del(key: string): void;
}

/**
 * A simple RW transaction for simple synchronous key-value stores.
 */
export class SimpleSyncRWTransaction implements SyncKeyValueRWTransaction {
	/**
	 * Stores data in the keys we modify prior to modifying them.
	 * Allows us to roll back commits.
	 */
	private originalData: { [key: string]: Buffer | undefined } = {};
	/**
	 * List of keys modified in this transaction, if any.
	 */
	private modifiedKeys: string[] = [];

	constructor(private store: SimpleSyncStore) {}

	public get(key: string): Buffer | undefined {
		const val = this.store.get(key);
		this.stashOldValue(key, val);
		return val;
	}

	public put(key: string, data: Buffer, overwrite: boolean): boolean {
		this.markModified(key);
		return this.store.put(key, data, overwrite);
	}

	public del(key: string): void {
		this.markModified(key);
		this.store.del(key);
	}

	public commit(): void {
		/* NOP */
	}

	public abort(): void {
		// Rollback old values.
		for (const key of this.modifiedKeys) {
			const value = this.originalData[key];
			if (!value) {
				// Key didn't exist.
				this.store.del(key);
			} else {
				// Key existed. Store old value.
				this.store.put(key, value, true);
			}
		}
	}

	private _has(key: string) {
		return Object.prototype.hasOwnProperty.call(this.originalData, key);
	}

	/**
	 * Stashes given key value pair into `originalData` if it doesn't already
	 * exist. Allows us to stash values the program is requesting anyway to
	 * prevent needless `get` requests if the program modifies the data later
	 * on during the transaction.
	 */
	private stashOldValue(key: string, value: Buffer | undefined) {
		// Keep only the earliest value in the transaction.
		if (!this._has(key)) {
			this.originalData[key] = value;
		}
	}

	/**
	 * Marks the given key as modified, and stashes its value if it has not been
	 * stashed already.
	 */
	private markModified(key: string) {
		if (this.modifiedKeys.indexOf(key) === -1) {
			this.modifiedKeys.push(key);
			if (!this._has(key)) {
				this.originalData[key] = this.store.get(key);
			}
		}
	}
}

export interface SyncKeyValueFileSystemOptions {
	/**
	 * The actual key-value store to read from/write to.
	 */
	store: SyncKeyValueStore;
	/**
	 * Should the file system support properties (mtime/atime/ctime/chmod/etc)?
	 * Enabling this slightly increases the storage space per file, and adds
	 * atime updates every time a file is accessed, mtime updates every time
	 * a file is modified, and permission checks on every operation.
	 *
	 * Defaults to *false*.
	 */
	supportProps?: boolean;
	/**
	 * Should the file system support links?
	 */
	supportLinks?: boolean;
}

export class SyncKeyValueFile extends PreloadFile<SyncKeyValueFileSystem> {
	constructor(_fs: SyncKeyValueFileSystem, _path: string, _flag: FileFlag, _stat: Stats, contents?: Buffer) {
		super(_fs, _path, _flag, _stat, contents);
	}

	public syncSync(): void {
		if (this.isDirty()) {
			this._fs._syncSync(this.getPath(), this.getBuffer(), this.getStats());
			this.resetDirty();
		}
	}

	public closeSync(): void {
		this.syncSync();
	}
}

/**
 * A "Synchronous key-value file system". Stores data to/retrieves data from an
 * underlying key-value store.
 *
 * We use a unique ID for each node in the file system. The root node has a
 * fixed ID.
 * @todo Introduce Node ID caching.
 * @todo Check modes.
 */
export class SyncKeyValueFileSystem extends SynchronousFileSystem {
	public static isAvailable(): boolean {
		return true;
	}

	private store: SyncKeyValueStore;

	constructor(options: SyncKeyValueFileSystemOptions) {
		super();
		this.store = options.store;
		// INVARIANT: Ensure that the root exists.
		this.makeRootDirectory();
	}

	public getName(): string {
		return this.store.name();
	}
	public isReadOnly(): boolean {
		return false;
	}
	public supportsSymlinks(): boolean {
		return false;
	}
	public supportsProps(): boolean {
		return true;
	}
	public supportsSynch(): boolean {
		return true;
	}

	/**
	 * Delete all contents stored in the file system.
	 */
	public empty(): void {
		this.store.clear();
		// INVARIANT: Root always exists.
		this.makeRootDirectory();
	}

	public accessSync(p: string, mode: number, cred: Cred): void {
		const tx = this.store.beginTransaction('readonly'),
			node = this.findINode(tx, p);
		if (!node.toStats().hasAccess(mode, cred)) {
			throw ApiError.EACCES(p);
		}
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		const tx = this.store.beginTransaction('readwrite'),
			oldParent = path.dirname(oldPath),
			oldName = path.basename(oldPath),
			newParent = path.dirname(newPath),
			newName = path.basename(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = this.findINode(tx, oldParent),
			oldDirList = this.getDirListing(tx, oldParent, oldDirNode);

		if (!oldDirNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.EACCES(oldPath);
		}

		if (!oldDirList[oldName]) {
			throw ApiError.ENOENT(oldPath);
		}
		const nodeId: string = oldDirList[oldName];
		delete oldDirList[oldName];

		// Invariant: Can't move a folder inside itself.
		// This funny little hack ensures that the check passes only if oldPath
		// is a subpath of newParent. We append '/' to avoid matching folders that
		// are a substring of the bottom-most folder in the path.
		if ((newParent + '/').indexOf(oldPath + '/') === 0) {
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
			newDirList = this.getDirListing(tx, newParent, newDirNode);
		}

		if (newDirList[newName]) {
			// If it's a file, delete it.
			const newNameNode = this.getINode(tx, newPath, newDirList[newName]);
			if (newNameNode.isFile()) {
				try {
					tx.del(newNameNode.id);
					tx.del(newDirList[newName]);
				} catch (e) {
					tx.abort();
					throw e;
				}
			} else {
				// If it's a directory, throw a permissions error.
				throw ApiError.EPERM(newPath);
			}
		}
		newDirList[newName] = nodeId;

		// Commit the two changed directory listings.
		try {
			tx.put(oldDirNode.id, Buffer.from(JSON.stringify(oldDirList)), true);
			tx.put(newDirNode.id, Buffer.from(JSON.stringify(newDirList)), true);
		} catch (e) {
			tx.abort();
			throw e;
		}

		tx.commit();
	}

	public statSync(p: string, cred: Cred): Stats {
		// Get the inode to the item, convert it into a Stats object.
		const stats = this.findINode(this.store.beginTransaction('readonly'), p).toStats();
		if (!stats.hasAccess(R_OK, cred)) {
			throw ApiError.EACCES(p);
		}
		return stats;
	}

	public createFileSync(p: string, flag: FileFlag, mode: number, cred: Cred): SyncKeyValueFile {
		const tx = this.store.beginTransaction('readwrite'),
			data = Buffer.alloc(0),
			newFile = this.commitNewFile(tx, p, FileType.FILE, mode, cred, data);
		// Open the file.
		return new SyncKeyValueFile(this, p, flag, newFile.toStats(), data);
	}

	public openFileSync(p: string, flag: FileFlag, cred: Cred): SyncKeyValueFile {
		const tx = this.store.beginTransaction('readonly'),
			node = this.findINode(tx, p),
			data = tx.get(node.id);
		if (!node.toStats().hasAccess(flag.getMode(), cred)) {
			throw ApiError.EACCES(p);
		}
		if (data === undefined) {
			throw ApiError.ENOENT(p);
		}
		return new SyncKeyValueFile(this, p, flag, node.toStats(), data);
	}

	public unlinkSync(p: string, cred: Cred): void {
		this.removeEntry(p, false, cred);
	}

	public rmdirSync(p: string, cred: Cred): void {
		// Check first if directory is empty.
		if (this.readdirSync(p, cred).length > 0) {
			throw ApiError.ENOTEMPTY(p);
		} else {
			this.removeEntry(p, true, cred);
		}
	}

	public mkdirSync(p: string, mode: number, cred: Cred): void {
		const tx = this.store.beginTransaction('readwrite'),
			data = Buffer.from('{}');
		this.commitNewFile(tx, p, FileType.DIRECTORY, mode, cred, data);
	}

	public readdirSync(p: string, cred: Cred): string[] {
		const tx = this.store.beginTransaction('readonly');
		const node = this.findINode(tx, p);
		if (!node.toStats().hasAccess(R_OK, cred)) {
			throw ApiError.EACCES(p);
		}
		return Object.keys(this.getDirListing(tx, p, node));
	}

	public chmodSync(p: string, mode: number, cred: Cred): void {
		const fd = this.openFileSync(p, FileFlag.getFileFlag('r+'), cred);
		fd.chmodSync(mode);
	}

	public chownSync(p: string, new_uid: number, new_gid: number, cred: Cred): void {
		const fd = this.openFileSync(p, FileFlag.getFileFlag('r+'), cred);
		fd.chownSync(new_uid, new_gid);
	}

	public _syncSync(p: string, data: Buffer, stats: Stats): void {
		// @todo Ensure mtime updates properly, and use that to determine if a data
		//       update is required.
		const tx = this.store.beginTransaction('readwrite'),
			// We use the _findInode helper because we actually need the INode id.
			fileInodeId = this._findINode(tx, path.dirname(p), path.basename(p)),
			fileInode = this.getINode(tx, p, fileInodeId),
			inodeChanged = fileInode.update(stats);

		try {
			// Sync data.
			tx.put(fileInode.id, data, true);
			// Sync metadata.
			if (inodeChanged) {
				tx.put(fileInodeId, fileInode.toBuffer(), true);
			}
		} catch (e) {
			tx.abort();
			throw e;
		}
		tx.commit();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	private makeRootDirectory() {
		const tx = this.store.beginTransaction('readwrite');
		if (tx.get(ROOT_NODE_ID) === undefined) {
			// Create new inode.
			const currTime = new Date().getTime(),
				// Mode 0666, owned by root:root
				dirInode = new Inode(randomUUID(), 4096, 511 | FileType.DIRECTORY, currTime, currTime, currTime, 0, 0);
			// If the root doesn't exist, the first random ID shouldn't exist,
			// either.
			tx.put(dirInode.id, getEmptyDirNode(), false);
			tx.put(ROOT_NODE_ID, dirInode.toBuffer(), false);
			tx.commit();
		}
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 * @return string The ID of the file's inode in the file system.
	 */
	private _findINode(tx: SyncKeyValueROTransaction, parent: string, filename: string, visited: Set<string> = new Set<string>()): string {
		const currentPath = path.posix.join(parent, filename);
		if (visited.has(currentPath)) {
			throw new ApiError(ErrorCode.EIO, 'Infinite loop detected while finding inode', currentPath);
		}

		visited.add(currentPath);
		const readDirectory = (inode: Inode): string => {
			// Get the root's directory listing.
			const dirList = this.getDirListing(tx, parent, inode);
			// Get the file's ID.
			if (dirList[filename]) {
				return dirList[filename];
			} else {
				throw ApiError.ENOENT(path.resolve(parent, filename));
			}
		};
		if (parent === '/') {
			if (filename === '') {
				// Return the root's ID.
				return ROOT_NODE_ID;
			} else {
				// Find the item in the root node.
				return readDirectory(this.getINode(tx, parent, ROOT_NODE_ID));
			}
		} else {
			return readDirectory(this.getINode(tx, parent + path.sep + filename, this._findINode(tx, path.dirname(parent), path.basename(parent), visited)));
		}
	}

	/**
	 * Finds the Inode of the given path.
	 * @param p The path to look up.
	 * @return The Inode of the path p.
	 * @todo memoize/cache
	 */
	private findINode(tx: SyncKeyValueROTransaction, p: string): Inode {
		return this.getINode(tx, p, this._findINode(tx, path.dirname(p), path.basename(p)));
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param p The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	private getINode(tx: SyncKeyValueROTransaction, p: string, id: string): Inode {
		const inode = tx.get(id);
		if (inode === undefined) {
			throw ApiError.ENOENT(p);
		}
		return Inode.fromBuffer(inode);
	}

	/**
	 * Given the Inode of a directory, retrieves the corresponding directory
	 * listing.
	 */
	private getDirListing(tx: SyncKeyValueROTransaction, p: string, inode: Inode): { [fileName: string]: string } {
		if (!inode.isDirectory()) {
			throw ApiError.ENOTDIR(p);
		}
		const data = tx.get(inode.id);
		if (data === undefined) {
			throw ApiError.ENOENT(p);
		}
		return JSON.parse(data.toString());
	}

	/**
	 * Creates a new node under a random ID. Retries 5 times before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random GUID.
	 * @return The GUID that the data was stored under.
	 */
	private addNewNode(tx: SyncKeyValueRWTransaction, data: Buffer): string {
		const retries = 0;
		let currId: string;
		while (retries < 5) {
			try {
				currId = randomUUID();
				tx.put(currId, data, false);
				return currId;
			} catch (e) {
				// Ignore and reroll.
			}
		}
		throw new ApiError(ErrorCode.EIO, 'Unable to commit data to key-value store.');
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with
	 * the given mode.
	 * Note: This will commit the transaction.
	 * @param p The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param data The data to store at the file's data node.
	 * @return The Inode for the new file.
	 */
	private commitNewFile(tx: SyncKeyValueRWTransaction, p: string, type: FileType, mode: number, cred: Cred, data: Buffer): Inode {
		const parentDir = path.dirname(p),
			fname = path.basename(p),
			parentNode = this.findINode(tx, parentDir),
			dirListing = this.getDirListing(tx, parentDir, parentNode),
			currTime = new Date().getTime();

		//Check that the creater has correct access
		if (!parentNode.toStats().hasAccess(0b0100 /* Write */, cred)) {
			throw ApiError.EACCES(p);
		}

		// Invariant: The root always exists.
		// If we don't check this prior to taking steps below, we will create a
		// file with name '' in root should p == '/'.
		if (p === '/') {
			throw ApiError.EEXIST(p);
		}

		// Check if file already exists.
		if (dirListing[fname]) {
			throw ApiError.EEXIST(p);
		}

		let fileNode: Inode;
		try {
			// Commit data.
			const dataId = this.addNewNode(tx, data);
			fileNode = new Inode(dataId, data.length, mode | type, currTime, currTime, currTime, cred.uid, cred.gid);
			// Commit file node.
			const fileNodeId = this.addNewNode(tx, fileNode.toBuffer());
			// Update and commit parent directory listing.
			dirListing[fname] = fileNodeId;
			tx.put(parentNode.id, Buffer.from(JSON.stringify(dirListing)), true);
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
	private removeEntry(p: string, isDir: boolean, cred: Cred): void {
		const tx = this.store.beginTransaction('readwrite'),
			parent: string = path.dirname(p),
			parentNode = this.findINode(tx, parent),
			parentListing = this.getDirListing(tx, parent, parentNode),
			fileName: string = path.basename(p);

		if (!parentListing[fileName]) {
			throw ApiError.ENOENT(p);
		}

		const fileNodeId = parentListing[fileName];

		// Get file inode.
		const fileNode = this.getINode(tx, p, fileNodeId);

		if (!fileNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.EACCES(p);
		}

		// Remove from directory listing of parent.
		delete parentListing[fileName];

		if (!isDir && fileNode.isDirectory()) {
			throw ApiError.EISDIR(p);
		} else if (isDir && !fileNode.isDirectory()) {
			throw ApiError.ENOTDIR(p);
		}

		try {
			// Delete data.
			tx.del(fileNode.id);
			// Delete node.
			tx.del(fileNodeId);
			// Update directory listing.
			tx.put(parentNode.id, Buffer.from(JSON.stringify(parentListing)), true);
		} catch (e) {
			tx.abort();
			throw e;
		}
		// Success.
		tx.commit();
	}
}
