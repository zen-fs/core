import { credentials } from '../../credentials.js';
import { S_IFDIR, S_IFREG, S_ISGID, S_ISUID } from '../../emulation/constants.js';
import { basename, dirname, parse, resolve } from '../../emulation/path.js';
import { Errno, ErrnoError } from '../../error.js';
import type { File } from '../../file.js';
import { PreloadFile } from '../../file.js';
import { FileSystem, type FileSystemMetadata } from '../../filesystem.js';
import { type Ino, Inode, randomIno, rootIno } from '../../inode.js';
import type { FileType, Stats } from '../../stats.js';
import { decodeDirListing, encodeDirListing, encodeUTF8 } from '../../utils.js';
import type { Store, Transaction } from './store.js';

const maxInodeAllocTries = 5;

/**
 * A file system which uses a key-value store.
 *
 * We use a unique ID for each node in the file system. The root node has a fixed ID.
 * @todo Introduce Node ID caching.
 * @todo Check modes.
 * @internal
 */
export class StoreFS<T extends Store = Store> extends FileSystem {
	private _initialized: boolean = false;

	public async ready(): Promise<void> {
		if (this._initialized) {
			return;
		}
		await this.checkRoot();
		this._initialized = true;
	}

	public constructor(protected store: T) {
		super();
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: this.store.name,
		};
	}

	/**
	 * Delete all contents stored in the file system.
	 * @deprecated
	 */
	public async empty(): Promise<void> {
		await this.store.clear();
		// Root always exists.
		await this.checkRoot();
	}

	/**
	 * Delete all contents stored in the file system.
	 * @deprecated
	 */
	public emptySync(): void {
		this.store.clearSync();
		// Root always exists.
		this.checkRootSync();
	}

	/**
	 * @todo Make rename compatible with the cache.
	 */
	public async rename(oldPath: string, newPath: string): Promise<void> {
		await using tx = this.store.transaction();
		const _old = parse(oldPath),
			_new = parse(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = await this.findINode(tx, _old.dir, 'rename'),
			oldDirList = await this.getDirListing(tx, oldDirNode, _old.dir);

		if (!oldDirList[_old.base]) {
			throw ErrnoError.With('ENOENT', oldPath, 'rename');
		}
		const nodeId: Ino = oldDirList[_old.base];
		delete oldDirList[_old.base];

		/* 
			Can't move a folder inside itself.
			This ensures that the check passes only if `oldPath` is a subpath of `_new.dir`.
			We append '/' to avoid matching folders that are a substring of the bottom-most folder in the path.
		*/
		if ((_new.dir + '/').indexOf(oldPath + '/') === 0) {
			throw new ErrnoError(Errno.EBUSY, _old.dir);
		}

		// Add newPath to parent's directory listing.

		const sameParent = _new.dir == _old.dir;

		// Prevent us from re-grabbing the same directory listing, which still contains `old_path.base.`
		const newDirNode: Inode = sameParent ? oldDirNode : await this.findINode(tx, _new.dir, 'rename');
		const newDirList: typeof oldDirList = sameParent ? oldDirList : await this.getDirListing(tx, newDirNode, _new.dir);

		if (newDirList[_new.base]) {
			// If it's a file, delete it, if it's a directory, throw a permissions error.
			const existing = new Inode(await this.get(tx, newDirList[_new.base], newPath, 'rename'));
			if (!existing.toStats().isFile()) {
				throw ErrnoError.With('EPERM', newPath, 'rename');
			}
			await tx.remove(existing.ino);
			await tx.remove(newDirList[_new.base]);
		}
		newDirList[_new.base] = nodeId;
		// Commit the two changed directory listings.
		await tx.set(oldDirNode.ino, encodeDirListing(oldDirList));
		await tx.set(newDirNode.ino, encodeDirListing(newDirList));
		await tx.commit();
	}

	public renameSync(oldPath: string, newPath: string): void {
		using tx = this.store.transaction();
		const _old = parse(oldPath),
			_new = parse(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = this.findINodeSync(tx, _old.dir, 'rename'),
			oldDirList = this.getDirListingSync(tx, oldDirNode, _old.dir);

		if (!oldDirList[_old.base]) {
			throw ErrnoError.With('ENOENT', oldPath, 'rename');
		}
		const ino: Ino = oldDirList[_old.base];
		delete oldDirList[_old.base];

		/* 
			Can't move a folder inside itself.
			This ensures that the check passes only if `oldPath` is a subpath of `_new.dir`.
			We append '/' to avoid matching folders that are a substring of the bottom-most folder in the path.
		*/
		if ((_new.dir + '/').indexOf(oldPath + '/') == 0) {
			throw new ErrnoError(Errno.EBUSY, _old.dir);
		}

		// Add newPath to parent's directory listing.
		const sameParent = _new.dir === _old.dir;

		// Prevent us from re-grabbing the same directory listing, which still contains `old_path.base.`
		const newDirNode: Inode = sameParent ? oldDirNode : this.findINodeSync(tx, _new.dir, 'rename');
		const newDirList: typeof oldDirList = sameParent ? oldDirList : this.getDirListingSync(tx, newDirNode, _new.dir);

		if (newDirList[_new.base]) {
			// If it's a file, delete it, if it's a directory, throw a permissions error.
			const existing = new Inode(this.getSync(tx, newDirList[_new.base], newPath, 'rename'));
			if (!existing.toStats().isFile()) {
				throw ErrnoError.With('EPERM', newPath, 'rename');
			}
			tx.removeSync(existing.ino);
			tx.removeSync(newDirList[_new.base]);
		}
		newDirList[_new.base] = ino;

		// Commit the two changed directory listings.
		tx.setSync(oldDirNode.ino, encodeDirListing(oldDirList));
		tx.setSync(newDirNode.ino, encodeDirListing(newDirList));
		tx.commitSync();
	}

	public async stat(path: string): Promise<Stats> {
		await using tx = this.store.transaction();
		return (await this.findINode(tx, path, 'stat')).toStats();
	}

	public statSync(path: string): Stats {
		using tx = this.store.transaction();
		return this.findINodeSync(tx, path, 'stat').toStats();
	}

	public async createFile(path: string, flag: string, mode: number): Promise<File> {
		const node = await this.commitNew(path, S_IFREG, mode, new Uint8Array(0));
		return new PreloadFile(this, path, flag, node.toStats(), new Uint8Array(0));
	}

	public createFileSync(path: string, flag: string, mode: number): File {
		this.commitNewSync(path, S_IFREG, mode);
		return this.openFileSync(path, flag);
	}

	public async openFile(path: string, flag: string): Promise<File> {
		await using tx = this.store.transaction();
		const node = await this.findINode(tx, path, 'openFile'),
			data = await tx.get(node.ino);
		if (!data) {
			throw ErrnoError.With('ENOENT', path, 'openFile');
		}
		return new PreloadFile(this, path, flag, node.toStats(), data);
	}

	public openFileSync(path: string, flag: string): File {
		using tx = this.store.transaction();
		const node = this.findINodeSync(tx, path, 'openFile'),
			data = tx.getSync(node.ino);
		if (!data) {
			throw ErrnoError.With('ENOENT', path, 'openFile');
		}
		return new PreloadFile(this, path, flag, node.toStats(), data);
	}

	public async unlink(path: string): Promise<void> {
		return this.remove(path, false, 'unlink');
	}

	public unlinkSync(path: string): void {
		this.removeSync(path, false, 'unlink');
	}

	public async rmdir(path: string): Promise<void> {
		if ((await this.readdir(path)).length) {
			throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		}
		await this.remove(path, true, 'rmdir');
	}

	public rmdirSync(path: string): void {
		if (this.readdirSync(path).length) {
			throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		}
		this.removeSync(path, true, 'rmdir');
	}

	public async mkdir(path: string, mode: number): Promise<void> {
		await this.commitNew(path, S_IFDIR, mode, encodeUTF8('{}'));
	}

	public mkdirSync(path: string, mode: number): void {
		this.commitNewSync(path, S_IFDIR, mode, encodeUTF8('{}'));
	}

	public async readdir(path: string): Promise<string[]> {
		await using tx = this.store.transaction();
		const node = await this.findINode(tx, path, 'readdir');
		return Object.keys(await this.getDirListing(tx, node, path));
	}

	public readdirSync(path: string): string[] {
		using tx = this.store.transaction();
		const node = this.findINodeSync(tx, path, 'readdir');
		return Object.keys(this.getDirListingSync(tx, node, path));
	}

	/**
	 * Updated the inode and data node at `path`
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		await using tx = this.store.transaction();
		// We use _findInode because we actually need the INode id.
		const fileInodeId = await this._findINode(tx, path, 'sync'),
			fileInode = new Inode(await this.get(tx, fileInodeId, path, 'sync')),
			inodeChanged = fileInode.update(stats);

		// Sync data.
		await tx.set(fileInode.ino, data);
		// Sync metadata.
		if (inodeChanged) {
			await tx.set(fileInodeId, fileInode.data);
		}

		await tx.commit();
	}

	/**
	 * Updated the inode and data node at `path`
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		using tx = this.store.transaction();
		// We use _findInode because we actually need the INode id.
		const fileInodeId = this._findINodeSync(tx, path, 'sync'),
			fileInode = new Inode(this.getSync(tx, fileInodeId, path, 'sync')),
			inodeChanged = fileInode.update(stats);

		// Sync data.
		tx.setSync(fileInode.ino, data);
		// Sync metadata.
		if (inodeChanged) {
			tx.setSync(fileInodeId, fileInode.data);
		}

		tx.commitSync();
	}

	public async link(target: string, link: string): Promise<void> {
		await using tx = this.store.transaction();

		const newDir: string = dirname(link),
			newDirNode = await this.findINode(tx, newDir, 'link'),
			listing = await this.getDirListing(tx, newDirNode, newDir);

		const ino = await this._findINode(tx, target, 'link');
		const node = new Inode(await this.get(tx, ino, target, 'link'));

		node.nlink++;
		listing[basename(link)] = ino;

		tx.setSync(ino, node.data);
		tx.setSync(newDirNode.ino, encodeDirListing(listing));
		tx.commitSync();
	}

	public linkSync(target: string, link: string): void {
		using tx = this.store.transaction();

		const newDir: string = dirname(link),
			newDirNode = this.findINodeSync(tx, newDir, 'link'),
			listing = this.getDirListingSync(tx, newDirNode, newDir);

		const ino = this._findINodeSync(tx, target, 'link');
		const node = new Inode(this.getSync(tx, ino, target, 'link'));

		node.nlink++;
		listing[basename(link)] = ino;

		tx.setSync(ino, node.data);
		tx.setSync(newDirNode.ino, encodeDirListing(listing));
		tx.commitSync();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	public async checkRoot(): Promise<void> {
		await using tx = this.store.transaction();
		if (await tx.get(rootIno)) {
			return;
		}
		// Create new inode. o777, owned by root:root
		const inode = new Inode();
		inode.mode = 0o777 | S_IFDIR;
		// If the root doesn't exist, the first random ID shouldn't exist either.
		await tx.set(inode.ino, encodeUTF8('{}'));
		await tx.set(rootIno, inode.data);
		await tx.commit();
	}

	/**
	 * Checks if the root directory exists. Creates it if it doesn't.
	 */
	public checkRootSync(): void {
		using tx = this.store.transaction();
		if (tx.getSync(rootIno)) {
			return;
		}
		// Create new inode, mode o777, owned by root:root
		const inode = new Inode();
		inode.mode = 0o777 | S_IFDIR;
		// If the root doesn't exist, the first random ID shouldn't exist either.
		tx.setSync(inode.ino, encodeUTF8('{}'));
		tx.setSync(rootIno, inode.data);
		tx.commitSync();
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 */
	private async _findINode(tx: Transaction, path: string, syscall: string, visited: Set<string> = new Set()): Promise<Ino> {
		if (visited.has(path)) {
			throw new ErrnoError(Errno.EIO, 'Infinite loop detected while finding inode', path);
		}

		visited.add(path);

		if (path == '/') {
			return rootIno;
		}

		const { dir: parent, base: filename } = parse(path);
		const inode = parent == '/' ? new Inode(await this.get(tx, rootIno, parent, syscall)) : await this.findINode(tx, parent, syscall, visited);
		const dirList = await this.getDirListing(tx, inode, parent);

		if (!(filename in dirList)) {
			throw ErrnoError.With('ENOENT', resolve(parent, filename), syscall);
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
	protected _findINodeSync(tx: Transaction, path: string, syscall: string, visited: Set<string> = new Set()): Ino {
		if (visited.has(path)) {
			throw new ErrnoError(Errno.EIO, 'Infinite loop detected while finding inode', path);
		}

		visited.add(path);

		if (path == '/') {
			return rootIno;
		}

		const { dir: parent, base: filename } = parse(path);
		const inode = parent == '/' ? new Inode(this.getSync(tx, rootIno, parent, syscall)) : this.findINodeSync(tx, parent, syscall, visited);
		const dir = this.getDirListingSync(tx, inode, parent);

		if (!(filename in dir)) {
			throw ErrnoError.With('ENOENT', resolve(parent, filename), syscall);
		}

		return dir[filename];
	}

	/**
	 * Finds the Inode of `path`.
	 * @param path The path to look up.
	 * @todo memoize/cache
	 */
	private async findINode(tx: Transaction, path: string, syscall: string, visited: Set<string> = new Set()): Promise<Inode> {
		const ino = await this._findINode(tx, path, syscall, visited);
		return new Inode(await this.get(tx, ino, path, syscall));
	}

	/**
	 * Finds the Inode of `path`.
	 * @param path The path to look up.
	 * @return The Inode of the path p.
	 * @todo memoize/cache
	 */
	protected findINodeSync(tx: Transaction, path: string, syscall: string, visited: Set<string> = new Set()): Inode {
		const ino = this._findINodeSync(tx, path, syscall, visited);
		return new Inode(this.getSync(tx, ino, path, syscall));
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param path The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	private async get(tx: Transaction, ino: Ino, path: string, syscall: string): Promise<Uint8Array> {
		const data = await tx.get(ino);
		if (!data) {
			throw ErrnoError.With('ENOENT', path, syscall);
		}
		return data;
	}

	/**
	 * Given the ID of a node, retrieves the corresponding Inode.
	 * @param tx The transaction to use.
	 * @param path The corresponding path to the file (used for error messages).
	 * @param ino The ID to look up.
	 */
	protected getSync(tx: Transaction, ino: Ino, path: string, syscall: string): Uint8Array {
		const data = tx.getSync(ino);
		if (!data) {
			throw ErrnoError.With('ENOENT', path, syscall);
		}
		return data;
	}

	/**
	 * Given the Inode of a directory, retrieves the corresponding directory
	 * listing.
	 */
	private async getDirListing(tx: Transaction, inode: Inode, path: string): Promise<{ [fileName: string]: Ino }> {
		const data = await tx.get(inode.ino);
		/*
			Occurs when data is undefined,or corresponds to something other than a directory listing.
			The latter should never occur unless the file system is corrupted.
		 */
		if (!data) {
			throw ErrnoError.With('ENOENT', path, 'getDirListing');
		}

		return decodeDirListing(data);
	}

	/**
	 * Given the Inode of a directory, retrieves the corresponding directory listing.
	 */
	protected getDirListingSync(tx: Transaction, inode: Inode, p?: string): { [fileName: string]: Ino } {
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
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with `mode`.
	 * Note: This will commit the transaction.
	 * @param path The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param data The data to store at the file's data node.
	 */
	private async commitNew(path: string, type: FileType, mode: number, data: Uint8Array = new Uint8Array(), syscall: string = '[[commitNew]]'): Promise<Inode> {
		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root if path is '/'.
		*/
		if (path == '/') {
			throw ErrnoError.With('EEXIST', path, syscall);
		}

		await using tx = this.store.transaction();

		const { dir: parentPath, base: fname } = parse(path);
		const parent = await this.findINode(tx, parentPath, syscall);
		const listing = await this.getDirListing(tx, parent, parentPath);

		// Check if file already exists.
		if (listing[fname]) {
			throw ErrnoError.With('EEXIST', path, syscall);
		}

		// Commit data.
		const inode = new Inode();
		inode.ino = await this.addNew(tx, data, path);
		inode.mode = mode | type;
		inode.uid = parent.mode & S_ISUID ? parent.uid : credentials.uid;
		inode.gid = parent.mode & S_ISGID ? parent.gid : credentials.gid;
		inode.size = data.length;

		// Update and commit parent directory listing.
		listing[fname] = await this.addNew(tx, inode.data, path);
		await tx.set(parent.ino, encodeDirListing(listing));
		await tx.commit();
		return inode;
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with `mode`.
	 * Note: This will commit the transaction.
	 * @param path The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param data The data to store at the file's data node.
	 * @return The Inode for the new file.
	 */
	protected commitNewSync(path: string, type: FileType, mode: number, data: Uint8Array = new Uint8Array(), syscall: string = '[[commitNew]]'): Inode {
		/*
			The root always exists.
			If we don't check this prior to taking steps below,
			we will create a file with name '' in root if path is '/'.
		*/
		if (path == '/') {
			throw ErrnoError.With('EEXIST', path, syscall);
		}

		using tx = this.store.transaction();

		const { dir: parentPath, base: fname } = parse(path);
		const parent = this.findINodeSync(tx, parentPath, syscall);

		const listing = this.getDirListingSync(tx, parent, parentPath);

		// Check if file already exists.
		if (listing[fname]) {
			throw ErrnoError.With('EEXIST', path, syscall);
		}

		// Commit data.
		const node = new Inode();
		node.ino = this.addNewSync(tx, data, path);
		node.size = data.length;
		node.mode = mode | type;
		node.uid = parent.mode & S_ISUID ? parent.uid : credentials.uid;
		node.gid = parent.mode & S_ISGID ? parent.gid : credentials.gid;
		// Update and commit parent directory listing.
		listing[fname] = this.addNewSync(tx, node.data, path);
		tx.setSync(parent.ino, encodeDirListing(listing));
		tx.commitSync();
		return node;
	}

	/**
	 * Remove all traces of `path` from the file system.
	 * @param path The path to remove from the file system.
	 * @param isDir Does the path belong to a directory, or a file?
	 * @todo Update mtime.
	 */
	private async remove(path: string, isDir: boolean, syscall: string): Promise<void> {
		await using tx = this.store.transaction();

		const { dir: parent, base: fileName } = parse(path),
			parentNode = await this.findINode(tx, parent, syscall),
			listing = await this.getDirListing(tx, parentNode, parent);

		if (!listing[fileName]) {
			throw ErrnoError.With('ENOENT', path, 'remove');
		}

		const fileIno = listing[fileName];

		// Get file inode.
		const fileNode = new Inode(await this.get(tx, fileIno, path, syscall));

		// Remove from directory listing of parent.
		delete listing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('EISDIR', path, 'remove');
		}

		await tx.set(parentNode.ino, encodeDirListing(listing));

		if (--fileNode.nlink < 1) {
			// remove file
			await tx.remove(fileNode.ino);
			await tx.remove(fileIno);
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
	protected removeSync(path: string, isDir: boolean, syscall: string): void {
		using tx = this.store.transaction();
		const { dir: parent, base: fileName } = parse(path),
			parentNode = this.findINodeSync(tx, parent, syscall),
			listing = this.getDirListingSync(tx, parentNode, parent),
			fileIno: Ino = listing[fileName];

		if (!fileIno) {
			throw ErrnoError.With('ENOENT', path, 'remove');
		}

		// Get file inode.
		const fileNode = new Inode(this.getSync(tx, fileIno, path, syscall));

		// Remove from directory listing of parent.
		delete listing[fileName];

		if (!isDir && fileNode.toStats().isDirectory()) {
			throw ErrnoError.With('EISDIR', path, 'remove');
		}

		// Update directory listing.
		tx.setSync(parentNode.ino, encodeDirListing(listing));

		if (--fileNode.nlink < 1) {
			// remove file
			tx.removeSync(fileNode.ino);
			tx.removeSync(fileIno);
		}

		// Success.
		tx.commitSync();
	}
}
