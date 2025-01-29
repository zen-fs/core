/* eslint-disable @typescript-eslint/require-await */
import { _throw } from 'utilium';
import { Stats } from '../stats.js';
import { S_IFDIR, S_IFMT, S_IFREG, S_ISGID, S_ISUID } from '../vfs/constants.js';
import { dirname, join, relative } from '../vfs/path.js';
import { ErrnoError } from './error.js';
import { LazyFile, type File } from './file.js';
import { Index } from './file_index.js';
import { FileSystem, type CreationOptions, type PureCreationOptions } from './filesystem.js';
import { Inode, type InodeLike } from './inode.js';

interface MoveInfo {
	from: string;
	to: string;
	inode: Inode;
}

/**
 * Uses an `Index` for metadata.
 */
export abstract class IndexFS extends FileSystem {
	public constructor(
		id: number,
		name: string,
		public readonly index: Index = new Index()
	) {
		super(id, name);
	}

	/**
	 * @deprecated
	 */
	public reloadFiles(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	/**
	 * @deprecated
	 */
	public reloadFilesSync(): never {
		throw ErrnoError.With('ENOTSUP');
	}

	/**
	 * Finds all the paths in the index that need to be moved for a rename
	 */
	private pathsForRename(oldPath: string, newPath: string): MoveInfo[] {
		if (newPath === oldPath) return [];
		if (!this.index.has(oldPath)) throw ErrnoError.With('ENOENT', oldPath, 'rename');
		if ((dirname(newPath) + '/').startsWith(oldPath + '/')) throw ErrnoError.With('EBUSY', dirname(oldPath), 'rename');
		const toRename: MoveInfo[] = [];
		for (const [from, inode] of this.index.entries()) {
			const rel = relative(oldPath, from);
			if (rel.startsWith('..')) continue;
			let to = join(newPath, rel);
			if (to.endsWith('/')) to = to.slice(0, -1);
			toRename.push({ from, to, inode });
		}
		return toRename;
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		for (const { from, to, inode } of this.pathsForRename(oldPath, newPath)) {
			const data = new Uint8Array(inode.size);
			await this.read(from, data, 0, inode.size);
			this.index.delete(from);
			this.index.set(to, inode);
			await this.write(to, data, 0);
		}
	}

	public renameSync(oldPath: string, newPath: string): void {
		for (const { from, to, inode } of this.pathsForRename(oldPath, newPath)) {
			const data = new Uint8Array(inode.size);
			this.readSync(from, data, 0, inode.size);
			this.index.delete(from);
			this.index.set(to, inode);
			this.writeSync(to, data, 0);
		}
	}

	public async stat(path: string): Promise<Stats> {
		return this.statSync(path);
	}

	public statSync(path: string): Stats {
		if (!this.index.has(path)) throw ErrnoError.With('ENOENT', path, 'stat');

		return new Stats(this.index.get(path));
	}

	public async openFile(path: string, flag: string): Promise<File> {
		const stats = this.index.get(path) ?? _throw(ErrnoError.With('ENOENT', path, 'openFile'));
		return new LazyFile(this, path, flag, stats);
	}
	public openFileSync(path: string, flag: string): File {
		const stats = this.index.get(path) ?? _throw(ErrnoError.With('ENOENT', path, 'openFile'));
		return new LazyFile(this, path, flag, stats);
	}

	protected _remove(path: string, isUnlink: boolean): void {
		const syscall = isUnlink ? 'unlink' : 'rmdir';
		const inode = this.index.get(path);
		if (!inode) throw ErrnoError.With('ENOENT', path, syscall);
		const isDir = (inode.mode & S_IFMT) == S_IFDIR;
		if (!isDir && !isUnlink) throw ErrnoError.With('ENOTDIR', path, syscall);
		if (isDir && isUnlink) throw ErrnoError.With('EISDIR', path, syscall);
		this.index.delete(path);
	}

	protected abstract remove(path: string): Promise<void>;
	protected abstract removeSync(path: string): void;

	public async unlink(path: string): Promise<void> {
		this._remove(path, true);
		await this.remove(path);
	}

	public unlinkSync(path: string): void {
		this._remove(path, true);
		this.removeSync(path);
	}

	public async rmdir(path: string): Promise<void> {
		this._remove(path, false);
		await this.remove(path);
	}

	public rmdirSync(path: string): void {
		this._remove(path, false);
		this.removeSync(path);
	}

	protected create(path: string, options: PureCreationOptions) {
		const syscall = (options.mode & S_IFMT) == S_IFDIR ? 'mkdir' : 'createFile';

		if (this.index.has(path)) throw ErrnoError.With('EEXIST', path, syscall);

		const parent = this.index.get(dirname(path));
		if (!parent) throw ErrnoError.With('ENOENT', dirname(path), syscall);

		const id = this.index._alloc();

		const inode = new Inode({
			ino: id,
			data: id + 1,
			mode: options.mode,
			size: 0,
			uid: parent.mode & S_ISUID ? parent.uid : options.uid,
			gid: parent.mode & S_ISGID ? parent.gid : options.gid,
		});

		this.index.set(path, inode);
		return inode;
	}

	public async createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File> {
		const node = this.create(path, { mode: mode | S_IFREG, ...options });
		return new LazyFile(this, path, flag, node.toStats());
	}

	public createFileSync(path: string, flag: string, mode: number, options: CreationOptions): File {
		const node = this.create(path, { mode: mode | S_IFREG, ...options });
		return new LazyFile(this, path, flag, node.toStats());
	}

	public async mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
		this.create(path, { mode: mode | S_IFDIR, ...options });
	}

	public mkdirSync(path: string, mode: number, options: CreationOptions): void {
		this.create(path, { mode: mode | S_IFDIR, ...options });
	}

	public link(target: string, link: string): Promise<void> {
		throw ErrnoError.With('ENOSYS', link, 'link');
	}

	public linkSync(target: string, link: string): void {
		throw ErrnoError.With('ENOSYS', link, 'link');
	}

	public async readdir(path: string): Promise<string[]> {
		return Object.keys(this.index.directoryEntries(path));
	}

	public readdirSync(path: string): string[] {
		return Object.keys(this.index.directoryEntries(path));
	}

	/**
	 * Optional hook for implementations to support updating metadata
	 */
	protected syncMetadata?(path: string, metadata: Readonly<InodeLike>): Promise<void>;

	public async sync(path: string, data?: Uint8Array, stats?: Readonly<InodeLike>): Promise<void> {
		const inode = this.index.get(path);
		if (!inode) throw ErrnoError.With('ENOENT', path, 'sync');
		if (inode.update(stats)) await this.syncMetadata?.(path, stats!);
		if (data) await this.write(path, data, 0);
	}

	/**
	 * Optional hook for implementations to support updating metadata
	 */
	protected syncMetadataSync?(path: string, metadata: Readonly<InodeLike>): void;

	public syncSync(path: string, data?: Uint8Array, stats?: Readonly<InodeLike>): void {
		const inode = this.index.get(path);
		if (!inode) throw ErrnoError.With('ENOENT', path, 'sync');
		if (inode.update(stats)) this.syncMetadataSync?.(path, stats!);
		if (data) this.writeSync(path, data, 0);
	}
}
