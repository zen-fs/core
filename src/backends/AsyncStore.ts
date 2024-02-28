import { dirname, basename, join, resolve } from '../emulation/path.js';
import { ApiError, ErrorCode } from '../ApiError.js';
import { Cred } from '../cred.js';
import { W_OK, R_OK } from '../emulation/constants.js';
import { PreloadFile, File, FileFlag } from '../file.js';
import { AsyncFileSystem } from '../filesystem.js';
import Inode from '../inode.js';
import { Stats, FileType } from '../stats.js';
import { ROOT_NODE_ID, randomUUID, encode, decode } from '../utils.js';

class LRUNode {
	public prev: LRUNode | null = null;
	public next: LRUNode | null = null;
	constructor(public key: string, public value: string) {}
}

// Adapted from https://chrisrng.svbtle.com/lru-cache-in-javascript
class LRUCache {
	private size = 0;
	private map: { [id: string]: LRUNode } = {};
	private head: LRUNode | null = null;
	private tail: LRUNode | null = null;
	constructor(public readonly limit: number) {}

	/**
	 * Change or add a new value in the cache
	 * We overwrite the entry if it already exists
	 */
	public set(key: string, value: string): void {
		const node = new LRUNode(key, value);
		if (this.map[key]) {
			this.map[key].value = node.value;
			this.remove(node.key);
		} else {
			if (this.size >= this.limit) {
				delete this.map[this.tail!.key];
				this.size--;
				this.tail = this.tail!.prev;
				this.tail!.next = null;
			}
		}
		this.setHead(node);
	}

	/* Retrieve a single entry from the cache */
	public get(key: string): string | null {
		if (this.map[key]) {
			const value = this.map[key].value;
			const node = new LRUNode(key, value);
			this.remove(key);
			this.setHead(node);
			return value;
		} else {
			return null;
		}
	}

	/* Remove a single entry from the cache */
	public remove(key: string): void {
		const node = this.map[key];
		if (!node) {
			return;
		}
		if (node.prev !== null) {
			node.prev.next = node.next;
		} else {
			this.head = node.next;
		}
		if (node.next !== null) {
			node.next.prev = node.prev;
		} else {
			this.tail = node.prev;
		}
		delete this.map[key];
		this.size--;
	}

	/* Resets the entire cache - Argument limit is optional to be reset */
	public removeAll() {
		this.size = 0;
		this.map = {};
		this.head = null;
		this.tail = null;
	}

	private setHead(node: LRUNode): void {
		node.next = this.head;
		node.prev = null;
		if (this.head !== null) {
			this.head.prev = node;
		}
		this.head = node;
		if (this.tail === null) {
			this.tail = node;
		}
		this.size++;
		this.map[node.key] = node;
	}
}

/**
 * Represents an *asynchronous* key-value store.
 */
export interface AsyncStore {
	/**
	 * The name of the key-value store.
	 */
	name: string;
	/**
	 * Empties the key-value store completely.
	 */
	clear(): Promise<void>;
	/**
	 * Begins a read-write transaction.
	 */
	beginTransaction(type: 'readwrite'): AsyncRWTransaction;
	/**
	 * Begins a read-only transaction.
	 */
	beginTransaction(type: 'readonly'): AsyncROTransaction;
	beginTransaction(type: string): AsyncROTransaction;
}

/**
 * Represents an asynchronous read-only transaction.
 */
export interface AsyncROTransaction {
	/**
	 * Retrieves the data at the given key.
	 * @param key The key to look under for data.
	 */
	get(key: string): Promise<Uint8Array>;
}

/**
 * Represents an asynchronous read-write transaction.
 */
export interface AsyncRWTransaction extends AsyncROTransaction {
	/**
	 * Adds the data to the store under the given key. Overwrites any existing
	 * data.
	 * @param key The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids writing the data if the key exists.
	 */
	put(key: string, data: Uint8Array, overwrite: boolean): Promise<boolean>;
	/**
	 * Deletes the data at the given key.
	 * @param key The key to delete from the store.
	 */
	remove(key: string): Promise<void>;
	/**
	 * Commits the transaction.
	 */
	commit(): Promise<void>;
	/**
	 * Aborts and rolls back the transaction.
	 */
	abort(): Promise<void>;
}

export class AsyncFile extends PreloadFile<AsyncStoreFileSystem> implements File {
	constructor(_fs: AsyncStoreFileSystem, _path: string, _flag: FileFlag, _stat: Stats, contents?: Uint8Array) {
		super(_fs, _path, _flag, _stat, contents);
	}

	public async sync(): Promise<void> {
		if (!this.isDirty()) {
			return;
		}

		await this._fs._sync(this.path, this.buffer, this.stats);

		this.resetDirty();
	}

	public syncSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public async close(): Promise<void> {
		this.sync();
	}

	public closeSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
}

/**
 * An "Asynchronous key-value file system". Stores data to/retrieves data from
 * an underlying asynchronous key-value store.
 */
export class AsyncStoreFileSystem extends AsyncFileSystem {
	protected store: AsyncStore;
	private _cache: LRUCache | null = null;

	protected _ready: Promise<this>;

	public ready() {
		return this._ready;
	}

	constructor(cacheSize: number) {
		super();
		if (cacheSize > 0) {
			this._cache = new LRUCache(cacheSize);
		}
	}

	/**
	 * Initializes the file system. Typically called by subclasses' async
	 * constructors.
	 */
	public async init(store: AsyncStore) {
		this.store = store;
		// INVARIANT: Ensure that the root exists.
		await this.makeRootDirectory();
	}

	/**
	 * Delete all contents stored in the file system.
	 */
	public async empty(): Promise<void> {
		if (this._cache) {
			this._cache.removeAll();
		}
		await this.store.clear();
		// INVARIANT: Root always exists.
		await this.makeRootDirectory();
	}

	/**
	 * @todo Make rename compatible with the cache.
	 */
	public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		const c = this._cache;
		if (this._cache) {
			// Clear and disable cache during renaming process.
			this._cache = null;
			c.removeAll();
		}

		try {
			const tx = this.store.beginTransaction('readwrite'),
				oldParent = dirname(oldPath),
				oldName = basename(oldPath),
				newParent = dirname(newPath),
				newName = basename(newPath),
				// Remove oldPath from parent's directory listing.
				oldDirNode = await this.findINode(tx, oldParent),
				oldDirList = await this.getDirListing(tx, oldParent, oldDirNode);

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
				newDirNode = await this.findINode(tx, newParent);
				newDirList = await this.getDirListing(tx, newParent, newDirNode);
			}

			if (newDirList[newName]) {
				// If it's a file, delete it.
				const newNameNode = await this.getINode(tx, newPath, newDirList[newName]);
				if (newNameNode.toStats().isFile()) {
					try {
						await tx.remove(newNameNode.id);
						await tx.remove(newDirList[newName]);
					} catch (e) {
						await tx.abort();
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
				await tx.put(oldDirNode.id, encode(JSON.stringify(oldDirList)), true);
				await tx.put(newDirNode.id, encode(JSON.stringify(newDirList)), true);
			} catch (e) {
				await tx.abort();
				throw e;
			}

			await tx.commit();
		} finally {
			if (c) {
				this._cache = c;
			}
		}
	}

	public async stat(p: string, cred: Cred): Promise<Stats> {
		const tx = this.store.beginTransaction('readonly');
		const inode = await this.findINode(tx, p);
		if (!inode) {
			throw ApiError.ENOENT(p);
		}
		const stats = inode.toStats();
		if (!stats.hasAccess(R_OK, cred)) {
			throw ApiError.EACCES(p);
		}
		return stats;
	}

	public async createFile(p: string, flag: FileFlag, mode: number, cred: Cred): Promise<File> {
		const tx = this.store.beginTransaction('readwrite'),
			data = new Uint8Array(0),
			newFile = await this.commitNewFile(tx, p, FileType.FILE, mode, cred, data);
		// Open the file.
		return new AsyncFile(this, p, flag, newFile.toStats(), data);
	}

	public async openFile(p: string, flag: FileFlag, cred: Cred): Promise<File> {
		const tx = this.store.beginTransaction('readonly'),
			node = await this.findINode(tx, p),
			data = await tx.get(node.id);
		if (!node.toStats().hasAccess(flag.getMode(), cred)) {
			throw ApiError.EACCES(p);
		}
		if (data === undefined) {
			throw ApiError.ENOENT(p);
		}
		return new AsyncFile(this, p, flag, node.toStats(), data);
	}

	public async unlink(p: string, cred: Cred): Promise<void> {
		return this.removeEntry(p, false, cred);
	}

	public async rmdir(p: string, cred: Cred): Promise<void> {
		// Check first if directory is empty.
		const list = await this.readdir(p, cred);
		if (list.length > 0) {
			throw ApiError.ENOTEMPTY(p);
		}
		await this.removeEntry(p, true, cred);
	}

	public async mkdir(p: string, mode: number, cred: Cred): Promise<void> {
		const tx = this.store.beginTransaction('readwrite'),
			data = encode('{}');
		await this.commitNewFile(tx, p, FileType.DIRECTORY, mode, cred, data);
	}

	public async readdir(p: string, cred: Cred): Promise<string[]> {
		const tx = this.store.beginTransaction('readonly');
		const node = await this.findINode(tx, p);
		if (!node.toStats().hasAccess(R_OK, cred)) {
			throw ApiError.EACCES(p);
		}
		return Object.keys(await this.getDirListing(tx, p, node));
	}

	public async chmod(p: string, mode: number, cred: Cred): Promise<void> {
		const fd = await this.openFile(p, FileFlag.getFileFlag('r+'), cred);
		await fd.chmod(mode);
	}

	public async chown(p: string, new_uid: number, new_gid: number, cred: Cred): Promise<void> {
		const fd = await this.openFile(p, FileFlag.getFileFlag('r+'), cred);
		await fd.chown(new_uid, new_gid);
	}

	public async _sync(p: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		// @todo Ensure mtime updates properly, and use that to determine if a data
		//       update is required.
		const tx = this.store.beginTransaction('readwrite'),
			// We use the _findInode helper because we actually need the INode id.
			fileInodeId = await this._findINode(tx, dirname(p), basename(p)),
			fileInode = await this.getINode(tx, p, fileInodeId),
			inodeChanged = fileInode.update(stats);

		try {
			// Sync data.
			await tx.put(fileInode.id, data, true);
			// Sync metadata.
			if (inodeChanged) {
				await tx.put(fileInodeId, fileInode.serialize(), true);
			}
		} catch (e) {
			await tx.abort();
			throw e;
		}
		await tx.commit();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	private async makeRootDirectory(): Promise<void> {
		const tx = this.store.beginTransaction('readwrite');
		if ((await tx.get(ROOT_NODE_ID)) === undefined) {
			// Create new inode.
			const currTime = new Date().getTime(),
				// Mode 0666, owned by root:root
				dirInode = new Inode(randomUUID(), 4096, 511 | FileType.DIRECTORY, currTime, currTime, currTime, 0, 0);
			// If the root doesn't exist, the first random ID shouldn't exist,
			// either.
			await tx.put(dirInode.id, encode('{}'), false);
			await tx.put(ROOT_NODE_ID, dirInode.serialize(), false);
			await tx.commit();
		}
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 */
	private async _findINode(tx: AsyncROTransaction, parent: string, filename: string, visited: Set<string> = new Set<string>()): Promise<string> {
		const currentPath = join(parent, filename);
		if (visited.has(currentPath)) {
			throw new ApiError(ErrorCode.EIO, 'Infinite loop detected while finding inode', currentPath);
		}

		visited.add(currentPath);
		if (this._cache) {
			const id = this._cache.get(currentPath);
			if (id) {
				return id;
			}
		}

		if (parent === '/') {
			if (filename === '') {
				// BASE CASE #1: Return the root's ID.
				if (this._cache) {
					this._cache.set(currentPath, ROOT_NODE_ID);
				}
				return ROOT_NODE_ID;
			} else {
				// BASE CASE #2: Find the item in the root node.
				const inode = await this.getINode(tx, parent, ROOT_NODE_ID);
				const dirList = await this.getDirListing(tx, parent, inode!);
				if (dirList![filename]) {
					const id = dirList![filename];
					if (this._cache) {
						this._cache.set(currentPath, id);
					}
					return id;
				} else {
					throw ApiError.ENOENT(resolve(parent, filename));
				}
			}
		} else {
			// Get the parent directory's INode, and find the file in its directory
			// listing.
			const inode = await this.findINode(tx, parent, visited);
			const dirList = await this.getDirListing(tx, parent, inode!);
			if (dirList![filename]) {
				const id = dirList![filename];
				if (this._cache) {
					this._cache.set(currentPath, id);
				}
				return id;
			} else {
				throw ApiError.ENOENT(resolve(parent, filename));
			}
		}
	}

	/**
	 * Finds the Inode of the given path.
	 * @param p The path to look up.
	 * @todo memoize/cache
	 */
	private async findINode(tx: AsyncROTransaction, p: string, visited: Set<string> = new Set<string>()): Promise<Inode> {
		const id = await this._findINode(tx, dirname(p), basename(p), visited);
		return this.getINode(tx, p, id!);
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param p The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	private async getINode(tx: AsyncROTransaction, p: string, id: string): Promise<Inode> {
		const data = await tx.get(id);
		if (!data) {
			throw ApiError.ENOENT(p);
		}
		return Inode.Deserialize(data);
	}

	/**
	 * Given the Inode of a directory, retrieves the corresponding directory
	 * listing.
	 */
	private async getDirListing(tx: AsyncROTransaction, p: string, inode: Inode): Promise<{ [fileName: string]: string }> {
		if (!inode.toStats().isDirectory()) {
			throw ApiError.ENOTDIR(p);
		}
		const data = await tx.get(inode.id);
		try {
			return JSON.parse(decode(data));
		} catch (e) {
			// Occurs when data is undefined, or corresponds to something other
			// than a directory listing. The latter should never occur unless
			// the file system is corrupted.
			throw ApiError.ENOENT(p);
		}
	}

	/**
	 * Adds a new node under a random ID. Retries 5 times before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random GUID.
	 */
	private async addNewNode(tx: AsyncRWTransaction, data: Uint8Array): Promise<string> {
		let retries = 0;
		const reroll = async () => {
			if (++retries === 5) {
				// Max retries hit. Return with an error.
				throw new ApiError(ErrorCode.EIO, 'Unable to commit data to key-value store.');
			} else {
				// Try again.
				const currId = randomUUID();
				const committed = await tx.put(currId, data, false);
				if (!committed) {
					return reroll();
				} else {
					return currId;
				}
			}
		};
		return reroll();
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
	private async commitNewFile(tx: AsyncRWTransaction, p: string, type: FileType, mode: number, cred: Cred, data: Uint8Array): Promise<Inode> {
		const parentDir = dirname(p),
			fname = basename(p),
			parentNode = await this.findINode(tx, parentDir),
			dirListing = await this.getDirListing(tx, parentDir, parentNode),
			currTime = new Date().getTime();

		//Check that the creater has correct access
		if (!parentNode.toStats().hasAccess(W_OK, cred)) {
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
			await tx.abort();
			throw ApiError.EEXIST(p);
		}
		try {
			// Commit data.
			const dataId = await this.addNewNode(tx, data);
			const fileNode = new Inode(dataId, data.length, mode | type, currTime, currTime, currTime, cred.uid, cred.gid);
			// Commit file node.
			const fileNodeId = await this.addNewNode(tx, fileNode.serialize());
			// Update and commit parent directory listing.
			dirListing[fname] = fileNodeId;
			await tx.put(parentNode.id, encode(JSON.stringify(dirListing)), true);
			await tx.commit();
			return fileNode;
		} catch (e) {
			tx.abort();
			throw e;
		}
	}

	/**
	 * Remove all traces of the given path from the file system.
	 * @param p The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	/**
	 * Remove all traces of the given path from the file system.
	 * @param p The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	private async removeEntry(p: string, isDir: boolean, cred: Cred): Promise<void> {
		if (this._cache) {
			this._cache.remove(p);
		}
		const tx = this.store.beginTransaction('readwrite'),
			parent: string = dirname(p),
			parentNode = await this.findINode(tx, parent),
			parentListing = await this.getDirListing(tx, parent, parentNode),
			fileName: string = basename(p);

		if (!parentListing[fileName]) {
			throw ApiError.ENOENT(p);
		}

		const fileNodeId = parentListing[fileName];

		// Get file inode.
		const fileNode = await this.getINode(tx, p, fileNodeId);

		if (!fileNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.EACCES(p);
		}

		// Remove from directory listing of parent.
		delete parentListing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ApiError.EISDIR(p);
		} else if (isDir && !fileNode.toStats().isDirectory()) {
			throw ApiError.ENOTDIR(p);
		}

		try {
			// Delete data.
			await tx.remove(fileNode.id);
			// Delete node.
			await tx.remove(fileNodeId);
			// Update directory listing.
			await tx.put(parentNode.id, encode(JSON.stringify(parentListing)), true);
		} catch (e) {
			await tx.abort();
			throw e;
		}
		// Success.
		await tx.commit();
	}
}
