// SPDX-License-Identifier: LGPL-3.0-or-later
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
		toRename.sort((a, b) => b.from.length - a.from.length);
		return toRename;
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		if (oldPath == newPath) return;
		const toRename = this.pathsForRename(oldPath, newPath);
		const contents = new Map<string, Uint8Array>();
		for (const { from, to, inode } of toRename) {
			const data = new Uint8Array(inode.size);
			await this.read(from, data, 0, inode.size);
			contents.set(to, data);
			this.index.delete(from);
			await this.remove(from);
			if (this.index.has(to)) await this.remove(to);
		}
		toRename.reverse();
		for (const { to, inode } of toRename) {
			const data = contents.get(to)!;
			this.index.set(to, inode);
			if ((inode.mode & S_IFMT) == S_IFDIR) await this._mkdir?.(to, inode);
			else await this.write(to, data, 0);
		}
	}

	public renameSync(oldPath: string, newPath: string): void {
		if (oldPath == newPath) return;
		const toRename = this.pathsForRename(oldPath, newPath);
		const contents = new Map<string, Uint8Array>();
		for (const { from, to, inode } of toRename) {
			const data = new Uint8Array(inode.size);
			this.readSync(from, data, 0, inode.size);
			contents.set(to, data);
			this.index.delete(from);
			this.removeSync(from);
			if (this.index.has(to)) this.removeSync(to);
		}
		toRename.reverse();
		for (const { to, inode } of toRename) {
			const data = contents.get(to)!;
			this.index.set(to, inode);
			if ((inode.mode & S_IFMT) == S_IFDIR) this._mkdirSync?.(to, inode);
			else this.writeSync(to, data, 0);
		}
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
		if (!isDir) this.index.delete(path);
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
		const entries = await this.readdir(path);
		if (entries.length) throw withErrno('ENOTEMPTY');
		this.index.delete(path);
		await this.remove(path);
	}

	public rmdirSync(path: string): void {
		this._remove(path, false);
		if (this.readdirSync(path).length) throw withErrno('ENOTEMPTY');
		this.index.delete(path);
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

	protected _mkdir?(path: string, options: CreationOptions): Promise<void>;
	protected _mkdirSync?(path: string, options: CreationOptions): void;

	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		options.mode |= S_IFDIR;
		const inode = this.create(path, options);
		await this._mkdir?.(path, options);
		return inode;
	}

	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		options.mode |= S_IFDIR;
		const inode = this.create(path, options);
		this._mkdirSync?.(path, options);
		return inode;
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
