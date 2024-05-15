import type { Cred } from '../../cred.js';
import { W_OK, R_OK } from '../../emulation/constants.js';
import { dirname, basename, join, resolve } from '../../emulation/path.js';
import { ErrnoError, Errno } from '../../error.js';
import { PreloadFile, flagToMode } from '../../file.js';
import { FileSystem, type FileSystemMetadata } from '../../filesystem.js';
import { type Ino, Inode, rootIno, randomIno } from '../../inode.js';
import { type Stats, FileType } from '../../stats.js';
import { encodeDirListing, encode, decodeDirListing } from '../../utils.js';
import type { Store, Transaction } from './store.js';

export interface StoreOptions {
	/**
	 * The actual key-value store to read from/write to.
	 */
	store: Store | Promise<Store>;
}

const maxInodeAllocTries = 5;

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

	public async ready(): Promise<void> {
		await super.ready();
		if (this._initialized) {
			return;
		}
		this._initialized = true;
		this._store = await this.options.store;
	}

	constructor(protected options: StoreOptions) {
		super();

		if (!(options.store instanceof Promise)) {
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
		await this.store.clear();
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
		const tx = this.store.transaction(),
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
			await tx.set(oldDirNode.ino, encodeDirListing(oldDirList));
			await tx.set(newDirNode.ino, encodeDirListing(newDirList));
		} catch (e) {
			await tx.abort();
			throw e;
		}

		await tx.commit();
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		const tx = this.store.transaction(),
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
			tx.setSync(oldDirNode.ino, encodeDirListing(oldDirList));
			tx.setSync(newDirNode.ino, encodeDirListing(newDirList));
		} catch (e) {
			tx.abortSync();
			throw e;
		}

		tx.commitSync();
	}

	public async stat(path: string, cred: Cred): Promise<Stats> {
		const tx = this.store.transaction();
		const inode = await this.findINode(tx, path);
		if (!inode) {
			throw ErrnoError.With('ENOENT', path, 'stat');
		}
		const stats = inode.toStats();
		if (!stats.hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', path, 'stat');
		}
		return stats;
	}

	public statSync(path: string, cred: Cred): Stats {
		// Get the inode to the item, convert it into a Stats object.
		const stats = this.findINodeSync(this.store.transaction(), path).toStats();
		if (!stats.hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', path, 'stat');
		}
		return stats;
	}

	public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<PreloadFile<this>> {
		const tx = this.store.transaction(),
			data = new Uint8Array(0),
			newFile = await this.commitNew(tx, path, FileType.FILE, mode, cred, data);
		// Open the file.
		return new PreloadFile(this, path, flag, newFile.toStats(), data);
	}

	public createFileSync(path: string, flag: string, mode: number, cred: Cred): PreloadFile<this> {
		this.commitNewSync(path, FileType.FILE, mode, cred);
		return this.openFileSync(path, flag, cred);
	}

	public async openFile(path: string, flag: string, cred: Cred): Promise<PreloadFile<this>> {
		const tx = this.store.transaction(),
			node = await this.findINode(tx, path),
			data = await tx.get(node.ino);
		if (!node.toStats().hasAccess(flagToMode(flag), cred)) {
			throw ErrnoError.With('EACCES', path, 'openFile');
		}
		if (!data) {
			throw ErrnoError.With('ENOENT', path, 'openFile');
		}
		return new PreloadFile(this, path, flag, node.toStats(), data);
	}

	public openFileSync(path: string, flag: string, cred: Cred): PreloadFile<this> {
		const tx = this.store.transaction(),
			node = this.findINodeSync(tx, path),
			data = tx.getSync(node.ino);
		if (!node.toStats().hasAccess(flagToMode(flag), cred)) {
			throw ErrnoError.With('EACCES', path, 'openFile');
		}
		if (!data) {
			throw ErrnoError.With('ENOENT', path, 'openFile');
		}
		return new PreloadFile(this, path, flag, node.toStats(), data);
	}

	public async unlink(path: string, cred: Cred): Promise<void> {
		return this.remove(path, false, cred);
	}

	public unlinkSync(path: string, cred: Cred): void {
		this.removeSync(path, false, cred);
	}

	public async rmdir(path: string, cred: Cred): Promise<void> {
		// Check first if directory is empty.
		const list = await this.readdir(path, cred);
		if (list.length > 0) {
			throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		}
		await this.remove(path, true, cred);
	}

	public rmdirSync(path: string, cred: Cred): void {
		// Check first if directory is empty.
		if (this.readdirSync(path, cred).length > 0) {
			throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		} else {
			this.removeSync(path, true, cred);
		}
	}

	public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
		const tx = this.store.transaction(),
			data = encode('{}');
		await this.commitNew(tx, path, FileType.DIRECTORY, mode, cred, data);
	}

	public mkdirSync(path: string, mode: number, cred: Cred): void {
		this.commitNewSync(path, FileType.DIRECTORY, mode, cred, encode('{}'));
	}

	public async readdir(path: string, cred: Cred): Promise<string[]> {
		const tx = this.store.transaction();
		const node = await this.findINode(tx, path);
		if (!node.toStats().hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', path, 'readdur');
		}
		return Object.keys(await this.getDirListing(tx, node, path));
	}

	public readdirSync(path: string, cred: Cred): string[] {
		const tx = this.store.transaction();
		const node = this.findINodeSync(tx, path);
		if (!node.toStats().hasAccess(R_OK, cred)) {
			throw ErrnoError.With('EACCES', path, 'readdir');
		}
		return Object.keys(this.getDirListingSync(tx, node, path));
	}

	/**
	 * Updated the inode and data node at the given path
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		const tx = this.store.transaction(),
			// We use _findInode because we actually need the INode id.
			fileInodeId = await this._findINode(tx, dirname(path), basename(path)),
			fileInode = await this.getINode(tx, fileInodeId, path),
			inodeChanged = fileInode.update(stats);

		try {
			// Sync data.
			await tx.set(fileInode.ino, data);
			// Sync metadata.
			if (inodeChanged) {
				await tx.set(fileInodeId, fileInode.data);
			}
		} catch (e) {
			await tx.abort();
			throw e;
		}
		await tx.commit();
	}

	/**
	 * Updated the inode and data node at the given path
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		const tx = this.store.transaction(),
			// We use _findInode because we actually need the INode id.
			fileInodeId = this._findINodeSync(tx, dirname(path), basename(path)),
			fileInode = this.getINodeSync(tx, fileInodeId, path),
			inodeChanged = fileInode.update(stats);

		try {
			// Sync data.
			tx.setSync(fileInode.ino, data);
			// Sync metadata.
			if (inodeChanged) {
				tx.setSync(fileInodeId, fileInode.data);
			}
		} catch (e) {
			tx.abortSync();
			throw e;
		}
		tx.commitSync();
	}

	public async link(existing: string, newpath: string, cred: Cred): Promise<void> {
		const tx = this.store.transaction(),
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
			tx.setSync(ino, node.data);
			tx.setSync(newDirNode.ino, encodeDirListing(newListing));
		} catch (e) {
			tx.abortSync();
			throw e;
		}
		tx.commitSync();
	}

	public linkSync(existing: string, newpath: string, cred: Cred): void {
		const tx = this.store.transaction(),
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
			tx.setSync(ino, node.data);
			tx.setSync(newDirNode.ino, encodeDirListing(newListing));
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
		const tx = this.store.transaction();
		if (await tx.get(rootIno)) {
			return;
		}
		// Create new inode. o777, owned by root:root
		const inode = new Inode();
		inode.mode = 0o777 | FileType.DIRECTORY;
		// If the root doesn't exist, the first random ID shouldn't exist either.
		await tx.set(inode.ino, encode('{}'));
		await tx.set(rootIno, inode.data);
		await tx.commit();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	protected makeRootDirectorySync(): void {
		const tx = this.store.transaction();
		if (tx.getSync(rootIno)) {
			return;
		}
		// Create new inode, mode o777, owned by root:root
		const inode = new Inode();
		inode.mode = 0o777 | FileType.DIRECTORY;
		// If the root doesn't exist, the first random ID shouldn't exist either.
		tx.setSync(inode.ino, encode('{}'));
		tx.setSync(rootIno, inode.data);
		tx.commitSync();
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 */
	private async _findINode(tx: Transaction, parent: string, filename: string, visited: Set<string> = new Set()): Promise<Ino> {
		const currentPath = join(parent, filename);
		if (visited.has(currentPath)) {
			throw new ErrnoError(Errno.EIO, 'Infinite loop detected while finding inode', currentPath);
		}

		visited.add(currentPath);

		if (parent == '/' && filename === '') {
			return rootIno;
		}

		const inode = parent == '/' ? await this.getINode(tx, rootIno, parent) : await this.findINode(tx, parent, visited);
		const dirList = await this.getDirListing(tx, inode, parent);

		if (!(filename in dirList)) {
			throw ErrnoError.With('ENOENT', resolve(parent, filename), '_findINode');
		}

		return dirList[filename];
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

		if (parent == '/' && filename === '') {
			return rootIno;
		}

		const inode = parent == '/' ? this.getINodeSync(tx, rootIno, parent) : this.findINodeSync(tx, parent, visited);
		const dir = this.getDirListingSync(tx, inode, parent);

		if (!(filename in dir)) {
			throw ErrnoError.With('ENOENT', resolve(parent, filename), '_findINode');
		}

		return dir[filename];
	}

	/**
	 * Finds the Inode of the given path.
	 * @param path The path to look up.
	 * @todo memoize/cache
	 */
	private async findINode(tx: Transaction, path: string, visited: Set<string> = new Set()): Promise<Inode> {
		const id = await this._findINode(tx, dirname(path), basename(path), visited);
		return this.getINode(tx, id!, path);
	}

	/**
	 * Finds the Inode of the given path.
	 * @param path The path to look up.
	 * @return The Inode of the path p.
	 * @todo memoize/cache
	 */
	protected findINodeSync(tx: Transaction, path: string, visited: Set<string> = new Set()): Inode {
		const ino = this._findINodeSync(tx, dirname(path), basename(path), visited);
		return this.getINodeSync(tx, ino, path);
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param path The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	private async getINode(tx: Transaction, id: Ino, path: string): Promise<Inode> {
		const data = await tx.get(id);
		if (!data) {
			throw ErrnoError.With('ENOENT', path, 'getINode');
		}
		return new Inode(data.buffer);
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param path The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	protected getINodeSync(tx: Transaction, id: Ino, path: string): Inode {
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
	private async getDirListing(tx: Transaction, inode: Inode, path: string): Promise<{ [fileName: string]: Ino }> {
		if (!inode.toStats().isDirectory()) {
			throw ErrnoError.With('ENOTDIR', path, 'getDirListing');
		}
		const data = await tx.get(inode.ino);
		if (!data) {
			/*
				Occurs when data is undefined, or corresponds to something other
				than a directory listing. The latter should never occur unless
				the file system is corrupted.
			 */
			throw ErrnoError.With('ENOENT', path, 'getDirListing');
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
	 * Adds a new node under a random ID. Retries before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random ino.
	 */
	private async addNew(tx: Transaction, data: Uint8Array, path: string): Promise<Ino> {
		for (let i = 0; i < maxInodeAllocTries; i++) {
			const ino: Ino = randomIno();
			if (await tx.get(ino)) {
				continue;
			}
			await tx.set(ino, data);
			return ino;
		}
		throw new ErrnoError(Errno.ENOSPC, 'No inode IDs available', path, 'addNewNode');
	}

	/**
	 * Creates a new node under a random ID. Retries before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random ino.
	 * @return The ino that the data was stored under.
	 */
	protected addNewSync(tx: Transaction, data: Uint8Array, path: string): Ino {
		for (let i = 0; i < maxInodeAllocTries; i++) {
			const ino: Ino = randomIno();
			if (tx.getSync(ino)) {
				continue;
			}
			tx.setSync(ino, data);
			return ino;
		}
		throw new ErrnoError(Errno.ENOSPC, 'No inode IDs available', path, 'addNewNode');
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with
	 * the given mode.
	 * Note: This will commit the transaction.
	 * @param path The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param cred The UID/GID to create the file with
	 * @param data The data to store at the file's data node.
	 */
	private async commitNew(tx: Transaction, path: string, type: FileType, mode: number, cred: Cred, data: Uint8Array): Promise<Inode> {
		const parentPath = dirname(path),
			parent = await this.findINode(tx, parentPath);

		//Check that the creater has correct access
		if (!parent.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', path, 'commitNewFile');
		}

		const fname = basename(path),
			listing = await this.getDirListing(tx, parent, parentPath);

		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root should path == '/'.
		*/
		if (path === '/') {
			throw ErrnoError.With('EEXIST', path, 'commitNewFile');
		}

		// Check if file already exists.
		if (listing[fname]) {
			await tx.abort();
			throw ErrnoError.With('EEXIST', path, 'commitNewFile');
		}
		try {
			// Commit data.

			const inode = new Inode();
			inode.ino = await this.addNew(tx, data, path);
			inode.mode = mode | type;
			inode.uid = cred.uid;
			inode.gid = cred.gid;
			inode.size = data.length;

			// Update and commit parent directory listing.
			listing[fname] = await this.addNew(tx, inode.data, path);
			await tx.set(parent.ino, encodeDirListing(listing));
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
	 * @param path The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param data The data to store at the file's data node.
	 * @return The Inode for the new file.
	 */
	protected commitNewSync(path: string, type: FileType, mode: number, cred: Cred, data: Uint8Array = new Uint8Array()): Inode {
		const tx = this.store.transaction(),
			parentPath = dirname(path),
			parent = this.findINodeSync(tx, parentPath);

		//Check that the creater has correct access
		if (!parent.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', path, 'commitNewFile');
		}

		const fname = basename(path),
			listing = this.getDirListingSync(tx, parent, parentPath);

		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root should p == '/'.
		*/
		if (path === '/') {
			throw ErrnoError.With('EEXIST', path, 'commitNewFile');
		}

		// Check if file already exists.
		if (listing[fname]) {
			throw ErrnoError.With('EEXIST', path, 'commitNewFile');
		}

		const node = new Inode();
		try {
			// Commit data.
			node.ino = this.addNewSync(tx, data, path);
			node.size = data.length;
			node.mode = mode | type;
			node.uid = cred.uid;
			node.gid = cred.gid;
			// Update and commit parent directory listing.
			listing[fname] = this.addNewSync(tx, node.data, path);
			tx.setSync(parent.ino, encodeDirListing(listing));
		} catch (e) {
			tx.abortSync();
			throw e;
		}
		tx.commitSync();
		return node;
	}

	/**
	 * Remove all traces of the given path from the file system.
	 * @param path The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	private async remove(path: string, isDir: boolean, cred: Cred): Promise<void> {
		const tx = this.store.transaction(),
			parent: string = dirname(path),
			parentNode = await this.findINode(tx, parent),
			listing = await this.getDirListing(tx, parentNode, parent),
			fileName: string = basename(path);

		if (!listing[fileName]) {
			throw ErrnoError.With('ENOENT', path, 'removeEntry');
		}

		const fileIno = listing[fileName];

		// Get file inode.
		const fileNode = await this.getINode(tx, fileIno, path);

		if (!fileNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', path, 'removeEntry');
		}

		// Remove from directory listing of parent.
		delete listing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('EISDIR', path, 'removeEntry');
		}

		if (isDir && !fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('ENOTDIR', path, 'removeEntry');
		}

		try {
			await tx.set(parentNode.ino, encodeDirListing(listing));

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
	 * @param path The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	protected removeSync(path: string, isDir: boolean, cred: Cred): void {
		const tx = this.store.transaction(),
			parent: string = dirname(path),
			parentNode = this.findINodeSync(tx, parent),
			listing = this.getDirListingSync(tx, parentNode, parent),
			fileName: string = basename(path),
			fileIno: Ino = listing[fileName];

		if (!fileIno) {
			throw ErrnoError.With('ENOENT', path, 'removeEntry');
		}

		// Get file inode.
		const fileNode = this.getINodeSync(tx, fileIno, path);

		if (!fileNode.toStats().hasAccess(W_OK, cred)) {
			throw ErrnoError.With('EACCES', path, 'removeEntry');
		}

		// Remove from directory listing of parent.
		delete listing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('EISDIR', path, 'removeEntry');
		}

		if (isDir && !fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('ENOTDIR', path, 'removeEntry');
		}

		try {
			// Update directory listing.
			tx.setSync(parentNode.ino, encodeDirListing(listing));

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
