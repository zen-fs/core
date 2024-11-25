import { credentials } from '../../credentials.js';
import { S_IFDIR, S_IFREG, S_ISGID, S_ISUID } from '../../emulation/constants.js';
import { basename, dirname, parse, resolve } from '../../emulation/path.js';
import { Errno, ErrnoError } from '../../error.js';
import type { File } from '../../file.js';
import { PreloadFile } from '../../file.js';
import { FileSystem, type FileSystemMetadata } from '../../filesystem.js';
import { Inode, rootIno } from '../../inode.js';
import type { FileType, Stats } from '../../stats.js';
import { decodeDirListing, encodeDirListing, encodeUTF8, randomBigInt } from '../../utils.js';
import type { Store, Transaction } from './store.js';
import { serialize } from 'utilium';

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
			oldDirNode = await this.findInode(tx, _old.dir, 'rename'),
			oldDirList = decodeDirListing(await this.get(tx, oldDirNode.data, _old.dir, 'rename'));

		if (!oldDirList[_old.base]) {
			throw ErrnoError.With('ENOENT', oldPath, 'rename');
		}
		const ino: bigint = oldDirList[_old.base];
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
		const newDirNode: Inode = sameParent ? oldDirNode : await this.findInode(tx, _new.dir, 'rename');
		const newDirList: typeof oldDirList = sameParent ? oldDirList : decodeDirListing(await this.get(tx, newDirNode.data, _new.dir, 'rename'));

		if (newDirList[_new.base]) {
			// If it's a file, delete it, if it's a directory, throw a permissions error.
			const existing = new Inode(await this.get(tx, newDirList[_new.base], newPath, 'rename'));
			if (!existing.toStats().isFile()) {
				throw ErrnoError.With('EPERM', newPath, 'rename');
			}
			await tx.remove(existing.data);
			await tx.remove(newDirList[_new.base]);
		}
		newDirList[_new.base] = ino;
		// Commit the two changed directory listings.
		await tx.set(oldDirNode.data, encodeDirListing(oldDirList));
		await tx.set(newDirNode.data, encodeDirListing(newDirList));
		await tx.commit();
	}

	public renameSync(oldPath: string, newPath: string): void {
		using tx = this.store.transaction();
		const _old = parse(oldPath),
			_new = parse(newPath),
			// Remove oldPath from parent's directory listing.
			oldDirNode = this.findInodeSync(tx, _old.dir, 'rename'),
			oldDirList = decodeDirListing(this.getSync(tx, oldDirNode.data, _old.dir, 'rename'));

		if (!oldDirList[_old.base]) {
			throw ErrnoError.With('ENOENT', oldPath, 'rename');
		}
		const ino: bigint = oldDirList[_old.base];
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
		const newDirNode: Inode = sameParent ? oldDirNode : this.findInodeSync(tx, _new.dir, 'rename');
		const newDirList: typeof oldDirList = sameParent ? oldDirList : decodeDirListing(this.getSync(tx, newDirNode.data, _new.dir, 'rename'));

		if (newDirList[_new.base]) {
			// If it's a file, delete it, if it's a directory, throw a permissions error.
			const existing = new Inode(this.getSync(tx, newDirList[_new.base], newPath, 'rename'));
			if (!existing.toStats().isFile()) {
				throw ErrnoError.With('EPERM', newPath, 'rename');
			}
			tx.removeSync(existing.data);
			tx.removeSync(newDirList[_new.base]);
		}
		newDirList[_new.base] = ino;

		// Commit the two changed directory listings.
		tx.setSync(oldDirNode.data, encodeDirListing(oldDirList));
		tx.setSync(newDirNode.data, encodeDirListing(newDirList));
		tx.commitSync();
	}

	public async stat(path: string): Promise<Stats> {
		await using tx = this.store.transaction();
		return (await this.findInode(tx, path, 'stat')).toStats();
	}

	public statSync(path: string): Stats {
		using tx = this.store.transaction();
		return this.findInodeSync(tx, path, 'stat').toStats();
	}

	public async createFile(path: string, flag: string, mode: number): Promise<File> {
		const node = await this.commitNew(path, S_IFREG, mode, new Uint8Array(), 'createFile');
		return new PreloadFile(this, path, flag, node.toStats(), new Uint8Array());
	}

	public createFileSync(path: string, flag: string, mode: number): File {
		const node = this.commitNewSync(path, S_IFREG, mode, new Uint8Array(), 'createFile');
		return new PreloadFile(this, path, flag, node.toStats(), new Uint8Array());
	}

	public async openFile(path: string, flag: string): Promise<File> {
		await using tx = this.store.transaction();
		const node = await this.findInode(tx, path, 'openFile');
		const data = await this.get(tx, node.data, path, 'openFile');

		return new PreloadFile(this, path, flag, node.toStats(), data);
	}

	public openFileSync(path: string, flag: string): File {
		using tx = this.store.transaction();
		const node = this.findInodeSync(tx, path, 'openFile');
		const data = this.getSync(tx, node.data, path, 'openFile');

		return new PreloadFile(this, path, flag, node.toStats(), data);
	}

	public async readFile(path: string): Promise<Uint8Array> {
		await using tx = this.store.transaction();
		const node = await this.findInode(tx, path, 'read');
		const data = await this.get(tx, node.data, path, 'read');
		return data;
	}

	public readFileSync(path: string): Uint8Array {
		using tx = this.store.transaction();
		const node = this.findInodeSync(tx, path, 'openFile');
		const data = this.getSync(tx, node.data, path, 'openFile');

		return data;
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
		await this.commitNew(path, S_IFDIR, mode, encodeUTF8('{}'), 'mkdir');
	}

	public mkdirSync(path: string, mode: number): void {
		this.commitNewSync(path, S_IFDIR, mode, encodeUTF8('{}'), 'mkdir');
	}

	public async readdir(path: string): Promise<string[]> {
		await using tx = this.store.transaction();
		const node = await this.findInode(tx, path, 'readdir');
		return Object.keys(decodeDirListing(await this.get(tx, node.data, path, 'readdir')));
	}

	public readdirSync(path: string): string[] {
		using tx = this.store.transaction();
		const node = this.findInodeSync(tx, path, 'readdir');
		return Object.keys(decodeDirListing(this.getSync(tx, node.data, path, 'readdir')));
	}

	/**
	 * Updated the inode and data node at `path`
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public async sync(path: string, data?: Uint8Array, stats: Readonly<Partial<Stats>> = {}): Promise<void> {
		await using tx = this.store.transaction();
		// We use _findInode because we actually need the INode id.
		const fileInodeId = await this._findInode(tx, path, 'sync'),
			fileInode = new Inode(await this.get(tx, fileInodeId, path, 'sync')),
			inodeChanged = fileInode.update(stats);

		// Sync data.
		if (data) await tx.set(fileInode.data, data);
		// Sync metadata.
		if (inodeChanged) {
			await tx.set(fileInodeId, serialize(fileInode));
		}

		await tx.commit();
	}

	/**
	 * Updated the inode and data node at `path`
	 * @todo Ensure mtime updates properly, and use that to determine if a data update is required.
	 */
	public syncSync(path: string, data?: Uint8Array, stats: Readonly<Partial<Stats>> = {}): void {
		using tx = this.store.transaction();
		// We use _findInode because we actually need the INode id.
		const fileInodeId = this._findInodeSync(tx, path, 'sync'),
			fileInode = new Inode(this.getSync(tx, fileInodeId, path, 'sync')),
			inodeChanged = fileInode.update(stats);

		// Sync data.
		if (data) tx.setSync(fileInode.data, data);
		// Sync metadata.
		if (inodeChanged) {
			tx.setSync(fileInodeId, serialize(fileInode));
		}

		tx.commitSync();
	}

	public async link(target: string, link: string): Promise<void> {
		await using tx = this.store.transaction();

		const newDir: string = dirname(link),
			newDirNode = await this.findInode(tx, newDir, 'link'),
			listing = decodeDirListing(await this.get(tx, newDirNode.data, newDir, 'link'));

		const ino = await this._findInode(tx, target, 'link');
		const node = new Inode(await this.get(tx, ino, target, 'link'));

		node.nlink++;
		listing[basename(link)] = ino;

		tx.setSync(ino, serialize(node));
		tx.setSync(newDirNode.data, encodeDirListing(listing));
		tx.commitSync();
	}

	public linkSync(target: string, link: string): void {
		using tx = this.store.transaction();

		const newDir: string = dirname(link),
			newDirNode = this.findInodeSync(tx, newDir, 'link'),
			listing = decodeDirListing(this.getSync(tx, newDirNode.data, newDir, 'link'));

		const ino = this._findInodeSync(tx, target, 'link');
		const node = new Inode(this.getSync(tx, ino, target, 'link'));

		node.nlink++;
		listing[basename(link)] = ino;

		tx.setSync(ino, serialize(node));
		tx.setSync(newDirNode.data, encodeDirListing(listing));
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
		inode.ino = rootIno;
		inode.mode = 0o777 | S_IFDIR;
		// If the root doesn't exist, the first random ID shouldn't exist either.
		await tx.set(inode.data, encodeUTF8('{}'));
		await tx.set(rootIno, serialize(inode));
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
		inode.ino = rootIno;
		inode.mode = 0o777 | S_IFDIR;
		// If the root doesn't exist, the first random ID shouldn't exist either.
		tx.setSync(inode.data, encodeUTF8('{}'));
		tx.setSync(rootIno, serialize(inode));
		tx.commitSync();
	}

	/**
	 * Helper function for findINode.
	 * @param parent The parent directory of the file we are attempting to find.
	 * @param filename The filename of the inode we are attempting to find, minus
	 *   the parent.
	 */
	private async _findInode(tx: Transaction, path: string, syscall: string, visited: Set<string> = new Set()): Promise<bigint> {
		if (visited.has(path)) {
			throw new ErrnoError(Errno.EIO, 'Infinite loop detected while finding inode', path);
		}

		visited.add(path);

		if (path == '/') {
			return rootIno;
		}

		const { dir: parent, base: filename } = parse(path);
		const inode = parent == '/' ? new Inode(await this.get(tx, rootIno, parent, syscall)) : await this.findInode(tx, parent, syscall, visited);
		const dirList = decodeDirListing(await this.get(tx, inode.data, parent, syscall));

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
	protected _findInodeSync(tx: Transaction, path: string, syscall: string, visited: Set<string> = new Set()): bigint {
		if (visited.has(path)) {
			throw new ErrnoError(Errno.EIO, 'Infinite loop detected while finding inode', path);
		}

		visited.add(path);

		if (path == '/') {
			return rootIno;
		}

		const { dir: parent, base: filename } = parse(path);
		const inode = parent == '/' ? new Inode(this.getSync(tx, rootIno, parent, syscall)) : this.findInodeSync(tx, parent, syscall, visited);
		const dir = decodeDirListing(this.getSync(tx, inode.data, parent, syscall));

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
	private async findInode(tx: Transaction, path: string, syscall: string, visited: Set<string> = new Set()): Promise<Inode> {
		const ino = await this._findInode(tx, path, syscall, visited);
		return new Inode(await this.get(tx, ino, path, syscall));
	}

	/**
	 * Finds the Inode of `path`.
	 * @param path The path to look up.
	 * @return The Inode of the path p.
	 * @todo memoize/cache
	 */
	protected findInodeSync(tx: Transaction, path: string, syscall: string, visited: Set<string> = new Set()): Inode {
		const ino = this._findInodeSync(tx, path, syscall, visited);
		return new Inode(this.getSync(tx, ino, path, syscall));
	}

	/**
	 * Given an ID, retrieves the corresponding data.
	 * @param tx The transaction to use.
	 * @param path The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	private async get(tx: Transaction, id: bigint, path: string, syscall: string): Promise<Uint8Array> {
		const data = await tx.get(id);
		if (!data) {
			throw ErrnoError.With('ENOENT', path, syscall);
		}
		return data;
	}

	/**
	 * Given an ID, retrieves the corresponding data.
	 * @param tx The transaction to use.
	 * @param path The corresponding path to the file (used for error messages).
	 * @param id The ID to look up.
	 */
	private getSync(tx: Transaction, id: bigint, path: string, syscall: string): Uint8Array {
		const data = tx.getSync(id);
		if (!data) {
			throw ErrnoError.With('ENOENT', path, syscall);
		}
		return data;
	}

	/**
	 * Adds a new node under a random ID. Retries before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random id.
	 */
	private async allocNew(tx: Transaction, path: string, syscall: string): Promise<bigint> {
		for (let i = 0; i < maxInodeAllocTries; i++) {
			const ino: bigint = randomBigInt();
			if (await tx.get(ino)) {
				continue;
			}
			return ino;
		}
		throw new ErrnoError(Errno.ENOSPC, 'No IDs available', path, syscall);
	}

	/**
	 * Creates a new node under a random ID. Retries before giving up in
	 * the exceedingly unlikely chance that we try to reuse a random id.
	 * @return The ino that the data was stored under.
	 */
	private allocNewSync(tx: Transaction, path: string, syscall: string): bigint {
		for (let i = 0; i < maxInodeAllocTries; i++) {
			const ino: bigint = randomBigInt();
			if (tx.getSync(ino)) {
				continue;
			}
			return ino;
		}
		throw new ErrnoError(Errno.ENOSPC, 'No IDs available', path, syscall);
	}

	/**
	 * Commits a new file (well, a FILE or a DIRECTORY) to the file system with `mode`.
	 * Note: This will commit the transaction.
	 * @param path The path to the new file.
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param data The data to store at the file's data node.
	 */
	private async commitNew(path: string, type: FileType, mode: number, data: Uint8Array, syscall: string): Promise<Inode> {
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
		const parent = await this.findInode(tx, parentPath, syscall);
		const listing = decodeDirListing(await this.get(tx, parent.data, parentPath, syscall));

		// Check if file already exists.
		if (listing[fname]) {
			throw ErrnoError.With('EEXIST', path, syscall);
		}

		// Commit data.
		const inode = new Inode();
		inode.ino = await this.allocNew(tx, path, syscall);
		inode.data = await this.allocNew(tx, path, syscall);
		inode.mode = mode | type;
		inode.uid = parent.mode & S_ISUID ? parent.uid : credentials.uid;
		inode.gid = parent.mode & S_ISGID ? parent.gid : credentials.gid;
		inode.size = data.length;
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
	 * @param type The type of the new file.
	 * @param mode The mode to create the new file with.
	 * @param data The data to store at the file's data node.
	 * @return The Inode for the new file.
	 */
	private commitNewSync(path: string, type: FileType, mode: number, data: Uint8Array, syscall: string): Inode {
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
		const parent = this.findInodeSync(tx, parentPath, syscall);

		const listing = decodeDirListing(this.getSync(tx, parent.data, parentPath, syscall));

		// Check if file already exists.
		if (listing[fname]) {
			throw ErrnoError.With('EEXIST', path, syscall);
		}

		// Commit data.
		const inode = new Inode();
		inode.ino = this.allocNewSync(tx, path, syscall);
		inode.data = this.allocNewSync(tx, path, syscall);
		inode.size = data.length;
		inode.mode = mode | type;
		inode.uid = parent.mode & S_ISUID ? parent.uid : credentials.uid;
		inode.gid = parent.mode & S_ISGID ? parent.gid : credentials.gid;
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
	private async remove(path: string, isDir: boolean, syscall: string): Promise<void> {
		await using tx = this.store.transaction();

		const { dir: parent, base: fileName } = parse(path),
			parentNode = await this.findInode(tx, parent, syscall),
			listing = decodeDirListing(await this.get(tx, parentNode.data, parent, syscall));

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

		await tx.set(parentNode.data, encodeDirListing(listing));

		if (--fileNode.nlink < 1) {
			// remove file
			await tx.remove(fileNode.data);
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
	private removeSync(path: string, isDir: boolean, syscall: string): void {
		using tx = this.store.transaction();
		const { dir: parent, base: fileName } = parse(path),
			parentNode = this.findInodeSync(tx, parent, syscall),
			listing = decodeDirListing(this.getSync(tx, parentNode.data, parent, syscall)),
			fileIno: bigint = listing[fileName];

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
		tx.setSync(parentNode.data, encodeDirListing(listing));

		if (--fileNode.nlink < 1) {
			// remove file
			tx.removeSync(fileNode.data);
			tx.removeSync(fileIno);
		}

		// Success.
		tx.commitSync();
	}
}
