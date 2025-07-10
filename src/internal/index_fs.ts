/* eslint-disable @typescript-eslint/require-await */
import { withErrno } from 'kerium';
import { _throw } from 'utilium';
import { dirname, join, relative } from '../path.js';
import { S_IFDIR, S_IFMT, S_IFREG, S_ISGID, S_ISUID } from '../vfs/constants.js';
import { Index } from './file_index.js';
import { FileSystem, type CreationOptions, type UsageInfo } from './filesystem.js';
import { Inode, type InodeLike } from './inode.js';

interface MoveInfo {
	from: string;
	to: string;
	inode: Inode;
}

/**
 * A file system that uses an `Index` for metadata.
 * @category Internals
 * @internal
 */
export abstract class IndexFS extends FileSystem {
	public constructor(
		id: number,
		name: string,
		public readonly index: Index = new Index()
	) {
		super(id, name);
	}

	public usage(): UsageInfo {
		return this.index.usage();
	}

	/**
	 * Finds all the paths in the index that need to be moved for a rename
	 */
	private pathsForRename(oldPath: string, newPath: string): MoveInfo[] {
		if (!this.index.has(oldPath)) throw withErrno('ENOENT');
		if ((dirname(newPath) + '/').startsWith(oldPath + '/')) throw withErrno('EBUSY');
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
		if (oldPath == newPath) return;
		for (const { from, to, inode } of this.pathsForRename(oldPath, newPath)) {
			const data = new Uint8Array(inode.size);
			await this.read(from, data, 0, inode.size);
			this.index.delete(from);
			this.index.set(to, inode);
			await this.write(to, data, 0);
		}
		await this.remove(oldPath);
	}

	public renameSync(oldPath: string, newPath: string): void {
		if (oldPath == newPath) return;
		for (const { from, to, inode } of this.pathsForRename(oldPath, newPath)) {
			const data = new Uint8Array(inode.size);
			this.readSync(from, data, 0, inode.size);
			this.index.delete(from);
			this.index.set(to, inode);
			this.writeSync(to, data, 0);
		}
		this.removeSync(oldPath);
	}

	public async stat(path: string): Promise<Inode> {
		const inode = this.index.get(path);
		if (!inode) throw withErrno('ENOENT');
		return inode;
	}

	public statSync(path: string): Inode {
		const inode = this.index.get(path);
		if (!inode) throw withErrno('ENOENT');
		return inode;
	}

	public async touch(path: string, metadata: InodeLike): Promise<void> {
		const inode = this.index.get(path) ?? _throw(withErrno('ENOENT'));
		inode.update(metadata);
	}

	public touchSync(path: string, metadata: InodeLike): void {
		const inode = this.index.get(path) ?? _throw(withErrno('ENOENT'));
		inode.update(metadata);
	}

	protected _remove(path: string, isUnlink: boolean): void {
		const inode = this.index.get(path);
		if (!inode) throw withErrno('ENOENT');
		const isDir = (inode.mode & S_IFMT) == S_IFDIR;
		if (!isDir && !isUnlink) throw withErrno('ENOTDIR');
		if (isDir && isUnlink) throw withErrno('EISDIR');
		if (isDir && this.readdirSync(path).length) throw withErrno('ENOTEMPTY');
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

	protected create(path: string, options: CreationOptions) {
		if (this.index.has(path)) throw withErrno('EEXIST');

		const parent = this.index.get(dirname(path));
		if (!parent) throw withErrno('ENOENT');

		const id = this.index._alloc();

		const inode = new Inode({
			ino: id,
			data: id + 1,
			mode: options.mode,
			size: 0,
			uid: parent.mode & S_ISUID ? parent.uid : options.uid,
			gid: parent.mode & S_ISGID ? parent.gid : options.gid,
			nlink: 1,
		});

		this.index.set(path, inode);
		return inode;
	}

	public async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		options.mode |= S_IFREG;
		return this.create(path, options);
	}

	public createFileSync(path: string, options: CreationOptions): InodeLike {
		options.mode |= S_IFREG;
		return this.create(path, options);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		options.mode |= S_IFDIR;
		return this.create(path, options);
	}

	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		options.mode |= S_IFDIR;
		return this.create(path, options);
	}

	public link(target: string, link: string): Promise<void> {
		throw withErrno('ENOSYS');
	}

	public linkSync(target: string, link: string): void {
		throw withErrno('ENOSYS');
	}

	public async readdir(path: string): Promise<string[]> {
		return Object.keys(this.index.directoryEntries(path));
	}

	public readdirSync(path: string): string[] {
		return Object.keys(this.index.directoryEntries(path));
	}

	public async sync(): Promise<void> {}

	public syncSync(): void {}
}
