import { dirname, basename, join, resolve } from '../emulation/path.js';
import { ApiError, ErrorCode } from '../ApiError.js';
import type { Cred } from '../cred.js';
import { W_OK, R_OK } from '../emulation/constants.js';
import { PreloadFile, flagToMode } from '../file.js';
import { Async, FileSystem, type FileSystemMetadata } from '../filesystem.js';
import { randomIno, type Ino, Inode } from '../inode.js';
import { type Stats, FileType } from '../stats.js';
import { encode, decodeDirListing, encodeDirListing } from '../utils.js';
import { rootIno } from '../inode.js';
import { InMemory } from './InMemory.js';

interface LRUNode<K, V> {
	key: K;
	value: V;
}

/**
 * Last Recently Used cache
 */
class LRUCache<K, V> {
	private cache: LRUNode<K, V>[] = [];

	constructor(public readonly limit: number) {}

	public set(key: K, value: V): void {
		const existingIndex = this.cache.findIndex(node => node.key === key);
		if (existingIndex != -1) {
			this.cache.splice(existingIndex, 1);
		} else if (this.cache.length >= this.limit) {
			this.cache.shift();
		}

		this.cache.push({ key, value });
	}

	public get(key: K): V | null {
		const node = this.cache.find(n => n.key === key);
		if (!node) {
			return;
		}

		// Move the accessed item to the end of the cache (most recently used)
		this.set(key, node.value);
		return node.value;
	}

	public remove(key: K): void {
		const index = this.cache.findIndex(node => node.key === key);
		if (index !== -1) {
			this.cache.splice(index, 1);
		}
	}

	public reset(): void {
		this.cache = [];
	}
}

/**
 * Represents an asynchronous key-value store.
 */
export interface AsyncStore {
	/**
	 * The name of the store.
	 */
	name: string;
	/**
	 * Empties the store completely.
	 */
	clear(): Promise<void>;
	/**
	 * Begins a transaction.
	 */
	beginTransaction(): AsyncTransaction;
}

/**
 * Represents an asynchronous transaction.
 */
export interface AsyncTransaction {
	/**
	 * Retrieves the data at the given key.
	 * @param key The key to look under for data.
	 */
	get(key: Ino): Promise<Uint8Array>;
	/**
	 * Adds the data to the store under the given key. Overwrites any existing
	 * data.
	 * @param key The key to add the data under.
	 * @param data The data to add to the store.
	 * @param overwrite If 'true', overwrite any existing data. If 'false',
	 *   avoids writing the data if the key exists.
	 */
	put(key: Ino, data: Uint8Array, overwrite: boolean): Promise<boolean>;
	/**
	 * Deletes the data at the given key.
	 * @param key The key to delete from the store.
	 */
	remove(key: Ino): Promise<void>;
	/**
	 * Commits the transaction.
	 */
	commit(): Promise<void>;
	/**
	 * Aborts and rolls back the transaction.
	 */
	abort(): Promise<void>;
}

export interface AsyncStoreOptions {
	/**
	 * Promise that resolves to the store
	 */
	store: Promise<AsyncStore> | AsyncStore;

	/**
	 * The size of the cache. If not provided, no cache will be used
	 */
	lruCacheSize?: number;

	/**
	 * The file system to use for synchronous methods. Defaults to InMemory
	 */
	sync?: FileSystem;
}

/**
 * An asynchronous file system which uses an async store to store its data.
 * @see AsyncStore
 * @internal
 */
export class AsyncStoreFS extends Async(FileSystem) {
	protected store: AsyncStore;
	private _cache?: LRUCache<string, Ino>;
	_sync: FileSystem;

	protected _ready: Promise<void>;

	public async ready() {
		if (this._options.lruCacheSize > 0) {
			this._cache = new LRUCache(this._options.lruCacheSize);
		}
		this.store = await this._options.store;
		await super.ready();
		await this.makeRootDirectory();
		this._sync = this._options.sync || InMemory.create({ name: 'test' });
		return this;
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: this.store.name,
		};
	}

	constructor(protected _options: AsyncStoreOptions) {
		super();
	}

	/**
	 * Delete all contents stored in the file system.
	 */
	public async empty(): Promise<void> {
		if (this._cache) {
			this._cache.reset();
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
			c.reset();
		}

		try {
			const tx = this.store.beginTransaction(),
				oldParent = dirname(oldPath),
				oldName = basename(oldPath),
				newParent = dirname(newPath),
				newName = basename(newPath),
				// Remove oldPath from parent's directory listing.
				oldDirNode = await this.findINode(tx, oldParent),
				oldDirList = await this.getDirListing(tx, oldDirNode, oldParent);

			if (!oldDirNode.toStats().hasAccess(W_OK, cred)) {
				throw ApiError.With('EACCES', oldPath, 'rename');
			}

			if (!oldDirList[oldName]) {
				throw ApiError.With('ENOENT', oldPath, 'rename');
			}
			const nodeId: Ino = oldDirList[oldName];
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
					throw ApiError.With('EPERM', newPath, 'rename');
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
		} finally {
			if (c) {
				this._cache = c;
			}
		}
	}

	public async stat(p: string, cred: Cred): Promise<Stats> {
		const tx = this.store.beginTransaction();
		const inode = await this.findINode(tx, p);
		if (!inode) {
			throw ApiError.With('ENOENT', p, 'stat');
		}
		const stats = inode.toStats();
		if (!stats.hasAccess(R_OK, cred)) {
			throw ApiError.With('EACCES', p, 'stat');
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

	public async openFile(p: string, flag: string, cred: Cred): Promise<PreloadFile<this>> {
		const tx = this.store.beginTransaction(),
			node = await this.findINode(tx, p),
			data = await tx.get(node.ino);
		if (!node.toStats().hasAccess(flagToMode(flag), cred)) {
			throw ApiError.With('EACCES', p, 'openFile');
		}
		if (!data) {
			throw ApiError.With('ENOENT', p, 'openFile');
		}
		return new PreloadFile(this, p, flag, node.toStats(), data);
	}

	public async unlink(p: string, cred: Cred): Promise<void> {
		return this.removeEntry(p, false, cred);
	}

	public async rmdir(p: string, cred: Cred): Promise<void> {
		// Check first if directory is empty.
		const list = await this.readdir(p, cred);
		if (list.length > 0) {
			throw ApiError.With('ENOTEMPTY', p, 'rmdir');
		}
		await this.removeEntry(p, true, cred);
	}

	public async mkdir(p: string, mode: number, cred: Cred): Promise<void> {
		const tx = this.store.beginTransaction(),
			data = encode('{}');
		await this.commitNewFile(tx, p, FileType.DIRECTORY, mode, cred, data);
	}

	public async readdir(p: string, cred: Cred): Promise<string[]> {
		const tx = this.store.beginTransaction();
		const node = await this.findINode(tx, p);
		if (!node.toStats().hasAccess(R_OK, cred)) {
			throw ApiError.With('EACCES', p, 'readdur');
		}
		return Object.keys(await this.getDirListing(tx, node, p));
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

	public async link(existing: string, newpath: string, cred: Cred): Promise<void> {
		const tx = this.store.beginTransaction(),
			existingDir: string = dirname(existing),
			existingDirNode = await this.findINode(tx, existingDir);

		if (!existingDirNode.toStats().hasAccess(R_OK, cred)) {
			throw ApiError.With('EACCES', existingDir, 'link');
		}

		const newDir: string = dirname(newpath),
			newDirNode = await this.findINode(tx, newDir),
			newListing = await this.getDirListing(tx, newDirNode, newDir);

		if (!newDirNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.With('EACCES', newDir, 'link');
		}

		const ino = await this._findINode(tx, existingDir, basename(existing));
		const node = await this.getINode(tx, ino, existing);

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
	private async makeRootDirectory(): Promise<void> {
		const tx = this.store.beginTransaction();
		if ((await tx.get(rootIno)) === undefined) {
			// Create new inode. o777, owned by root:root
			const dirInode = new Inode();
			dirInode.mode = 0o777 | FileType.DIRECTORY;
			// If the root doesn't exist, the first random ID shouldn't exist,
			// either.
			await tx.put(dirInode.ino, encode('{}'), false);
			await tx.put(rootIno, dirInode.data, false);
			await tx.commit();
		}
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 */
	private async _findINode(tx: AsyncTransaction, parent: string, filename: string, visited: Set<string> = new Set<string>()): Promise<Ino> {
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
					this._cache.set(currentPath, rootIno);
				}
				return rootIno;
			} else {
				// BASE CASE #2: Find the item in the root node.
				const inode = await this.getINode(tx, rootIno, parent);
				const dirList = await this.getDirListing(tx, inode!, parent);
				if (dirList![filename]) {
					const id = dirList![filename];
					if (this._cache) {
						this._cache.set(currentPath, id);
					}
					return id;
				} else {
					throw ApiError.With('ENOENT', resolve(parent, filename), '_findINode');
				}
			}
		} else {
			// Get the parent directory's INode, and find the file in its directory
			// listing.
			const inode = await this.findINode(tx, parent, visited);
			const dirList = await this.getDirListing(tx, inode!, parent);
			if (dirList![filename]) {
				const id = dirList![filename];
				if (this._cache) {
					this._cache.set(currentPath, id);
				}
				return id;
			} else {
				throw ApiError.With('ENOENT', resolve(parent, filename), '_findINode');
			}
		}
	}

	/**
	 * Finds the Inode of the given path.
	 * @param p The path to look up.
	 * @todo memoize/cache
	 */
	private async findINode(tx: AsyncTransaction, p: string, visited: Set<string> = new Set<string>()): Promise<Inode> {
		const id = await this._findINode(tx, dirname(p), basename(p), visited);
		return this.getINode(tx, id!, p);
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param p The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	private async getINode(tx: AsyncTransaction, id: Ino, p: string): Promise<Inode> {
		const data = await tx.get(id);
		if (!data) {
			throw ApiError.With('ENOENT', p, 'getINode');
		}
		return new Inode(data.buffer);
	}

	/**
	 * Given the Inode of a directory, retrieves the corresponding directory
	 * listing.
	 */
	private async getDirListing(tx: AsyncTransaction, inode: Inode, p: string): Promise<{ [fileName: string]: Ino }> {
		if (!inode.toStats().isDirectory()) {
			throw ApiError.With('ENOTDIR', p, 'getDirListing');
		}
		const data = await tx.get(inode.ino);
		if (!data) {
			/*
				Occurs when data is undefined, or corresponds to something other
				than a directory listing. The latter should never occur unless
				the file system is corrupted.
			 */
			throw ApiError.With('ENOENT', p, 'getDirListing');
		}

		return decodeDirListing(data);
	}

	/**
	 * Adds a new node under a random ID. Retries 5 times before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random ino.
	 */
	private async addNewNode(tx: AsyncTransaction, data: Uint8Array, _maxAttempts: number = 5): Promise<Ino> {
		if (_maxAttempts <= 0) {
			// Max retries hit. Return with an error.
			throw new ApiError(ErrorCode.EIO, 'Unable to commit data to key-value store.');
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
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with
	 * the given mode.
	 * Note: This will commit the transaction.
	 * @param p The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param cred The UID/GID to create the file with
	 * @param data The data to store at the file's data node.
	 */
	private async commitNewFile(tx: AsyncTransaction, p: string, type: FileType, mode: number, cred: Cred, data: Uint8Array): Promise<Inode> {
		const parentDir = dirname(p),
			fname = basename(p),
			parentNode = await this.findINode(tx, parentDir),
			dirListing = await this.getDirListing(tx, parentNode, parentDir);

		//Check that the creater has correct access
		if (!parentNode.toStats().hasAccess(W_OK, cred)) {
			throw ApiError.With('EACCES', p, 'commitNewFile');
		}

		// Invariant: The root always exists.
		// If we don't check this prior to taking steps below, we will create a
		// file with name '' in root should p == '/'.
		if (p === '/') {
			throw ApiError.With('EEXIST', p, 'commitNewFile');
		}

		// Check if file already exists.
		if (dirListing[fname]) {
			await tx.abort();
			throw ApiError.With('EEXIST', p, 'commitNewFile');
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
		const tx = this.store.beginTransaction(),
			parent: string = dirname(p),
			parentNode = await this.findINode(tx, parent),
			parentListing = await this.getDirListing(tx, parentNode, parent),
			fileName: string = basename(p);

		if (!parentListing[fileName]) {
			throw ApiError.With('ENOENT', p, 'removeEntry');
		}

		const fileIno = parentListing[fileName];

		// Get file inode.
		const fileNode = await this.getINode(tx, fileIno, p);

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
}
