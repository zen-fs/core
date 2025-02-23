import type { File } from '../internal/file.js';
import type { CreationOptions, StreamOptions, UsageInfo } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import type { Stats } from '../stats.js';
import type { Backend } from './backend.js';

import { canary } from 'utilium';
import { Errno, ErrnoError } from '../internal/error.js';
import { LazyFile } from '../internal/file.js';
import { FileSystem } from '../internal/filesystem.js';
import { debug, err, warn } from '../internal/log.js';
import { dirname, join } from '../vfs/path.js';
import { EventEmitter } from 'eventemitter3';
import { resolveMountConfig, type MountConfiguration } from '../config.js';

/**
 * Configuration options for CoW.
 * @category Backends and Configuration
 */
export interface CopyOnWriteOptions {
	/** The file system that initially populates this file system. */
	readable: MountConfiguration<any>;

	/** The file system to write modified files to. */
	writable: MountConfiguration<any>;

	/** @see {@link Journal} */
	journal?: Journal;
}

/**
 *  @hidden @deprecated use `CopyOnWriteOptions`
 */
export type OverlayOptions = CopyOnWriteOptions;

const journalOperations = ['delete'] as const;

/**
 * @internal
 */
export type JournalOperation = (typeof journalOperations)[number];

/** Because TS doesn't work right w/o it */
function isJournalOp(op: string): op is JournalOperation {
	return journalOperations.includes(op as any);
}

const maxOpLength = Math.max(...journalOperations.map(op => op.length));

/**
 * @internal
 */
export interface JournalEntry {
	path: string;
	op: JournalOperation;
}

const journalMagicString = '#journal@v0\n';

/**
 * Tracks various operations for the CoW backend
 * @internal
 */
export class Journal extends EventEmitter<{
	update: [op: JournalOperation, path: string];
	delete: [path: string];
}> {
	protected entries: JournalEntry[] = [];

	public toString(): string {
		return journalMagicString + this.entries.map(entry => `${entry.op.padEnd(maxOpLength)} ${entry.path}`).join('\n');
	}

	/**
	 * Parse a journal from a string
	 */
	public fromString(value: string): this {
		if (!value.startsWith(journalMagicString)) throw err(new ErrnoError(Errno.EINVAL, 'Invalid journal contents, refusing to parse'));

		for (const line of value.split('\n')) {
			if (line.startsWith('#')) continue; // ignore comments

			const [op, path] = line.split(/\s+/);

			if (!isJournalOp(op)) {
				warn('Unknown operation in journal (skipping): ' + op);
				continue;
			}

			this.entries.push({ op, path });
		}

		return this;
	}

	public add(op: JournalOperation, path: string) {
		this.entries.push({ op, path });
		this.emit('update', op, path);
		this.emit(op, path);
	}

	public has(op: JournalOperation, path: string): boolean {
		const test = JSON.stringify({ op, path });
		for (const entry of this.entries) if (JSON.stringify(entry) === test) return true;
		return false;
	}

	public isDeleted(path: string): boolean {
		let deleted = false;

		for (const entry of this.entries) {
			if (entry.path != path) continue;

			switch (entry.op) {
				case 'delete':
					deleted = true;
			}
		}

		return deleted;
	}
}

/**
 * Using a readable file system as a base, writes are done to a writable file system.
 * @internal
 */
export class CopyOnWriteFS extends FileSystem {
	async ready(): Promise<void> {
		await this.readable.ready();
		await this.writable.ready();
	}

	public constructor(
		/** The file system that initially populates this file system. */
		public readonly readable: FileSystem,

		/** The file system to write modified files to. */
		public readonly writable: FileSystem,

		/** The journal to use for persisting deletions */
		public readonly journal = new Journal()
	) {
		super(0x62756c6c, readable.name);

		if (writable.attributes.has('no_write')) {
			throw err(new ErrnoError(Errno.EINVAL, 'Writable file system can not be written to'));
		}

		readable.attributes.set('no_write');
	}

	public isDeleted(path: string): boolean {
		return this.journal.isDeleted(path);
	}

	/**
	 * @todo Consider trying to track information on the writable as well
	 */
	public usage(): UsageInfo {
		return this.readable.usage();
	}

	public async sync(path: string, data: Uint8Array, stats: Readonly<InodeLike>): Promise<void> {
		await this.copyForWrite(path);
		await this.writable.sync(path, data, stats);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<InodeLike>): void {
		this.copyForWriteSync(path);
		this.writable.syncSync(path, data, stats);
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		return (await this.writable.exists(path))
			? await this.writable.read(path, buffer, offset, end)
			: await this.readable.read(path, buffer, offset, end);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		return this.writable.existsSync(path) ? this.writable.readSync(path, buffer, offset, end) : this.readable.readSync(path, buffer, offset, end);
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		await this.copyForWrite(path);
		return await this.writable.write(path, buffer, offset);
	}

	public writeSync(path: string, buffer: Uint8Array, offset: number): void {
		this.copyForWriteSync(path);
		return this.writable.writeSync(path, buffer, offset);
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		await this.copyForWrite(oldPath);

		try {
			await this.writable.rename(oldPath, newPath);
		} catch {
			if (this.isDeleted(oldPath)) {
				throw ErrnoError.With('ENOENT', oldPath, 'rename');
			}
		}
	}

	public renameSync(oldPath: string, newPath: string): void {
		this.copyForWriteSync(oldPath);

		try {
			this.writable.renameSync(oldPath, newPath);
		} catch {
			if (this.isDeleted(oldPath)) {
				throw ErrnoError.With('ENOENT', oldPath, 'rename');
			}
		}
	}

	public async stat(path: string): Promise<Stats> {
		try {
			return await this.writable.stat(path);
		} catch {
			if (this.isDeleted(path)) throw ErrnoError.With('ENOENT', path, 'stat');

			const oldStat = await this.readable.stat(path);
			// Make the oldStat's mode writable.
			oldStat.mode |= 0o222;
			return oldStat;
		}
	}

	public statSync(path: string): Stats {
		try {
			return this.writable.statSync(path);
		} catch {
			if (this.isDeleted(path)) throw ErrnoError.With('ENOENT', path, 'stat');

			const oldStat = this.readable.statSync(path);
			// Make the oldStat's mode writable.
			oldStat.mode |= 0o222;
			return oldStat;
		}
	}

	public async openFile(path: string, flag: string): Promise<File> {
		if (await this.writable.exists(path)) {
			return this.writable.openFile(path, flag);
		}
		const stats = await this.readable.stat(path);
		return new LazyFile(this, path, flag, stats);
	}

	public openFileSync(path: string, flag: string): File {
		if (this.writable.existsSync(path)) {
			return this.writable.openFileSync(path, flag);
		}
		const stats = this.readable.statSync(path);
		return new LazyFile(this, path, flag, stats);
	}

	public async createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File> {
		await this.writable.createFile(path, flag, mode, options);
		return this.openFile(path, flag);
	}

	public createFileSync(path: string, flag: string, mode: number, options: CreationOptions): File {
		this.writable.createFileSync(path, flag, mode, options);
		return this.openFileSync(path, flag);
	}

	public async link(srcpath: string, dstpath: string): Promise<void> {
		await this.copyForWrite(srcpath);
		await this.writable.link(srcpath, dstpath);
	}

	public linkSync(srcpath: string, dstpath: string): void {
		this.copyForWriteSync(srcpath);
		this.writable.linkSync(srcpath, dstpath);
	}

	public async unlink(path: string): Promise<void> {
		if (!(await this.exists(path))) {
			throw ErrnoError.With('ENOENT', path, 'unlink');
		}

		if (await this.writable.exists(path)) {
			await this.writable.unlink(path);
		}

		// if it still exists add to the delete log
		if (await this.exists(path)) {
			this.journal.add('delete', path);
		}
	}

	public unlinkSync(path: string): void {
		if (!this.existsSync(path)) throw ErrnoError.With('ENOENT', path, 'unlink');

		if (this.writable.existsSync(path)) {
			this.writable.unlinkSync(path);
		}

		// if it still exists add to the delete log
		if (this.existsSync(path)) {
			this.journal.add('delete', path);
		}
	}

	public async rmdir(path: string): Promise<void> {
		if (!(await this.exists(path))) {
			throw ErrnoError.With('ENOENT', path, 'rmdir');
		}
		if (await this.writable.exists(path)) {
			await this.writable.rmdir(path);
		}
		if (!(await this.exists(path))) {
			return;
		}
		// Check if directory is empty.
		if ((await this.readdir(path)).length) {
			throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		}
		this.journal.add('delete', path);
	}

	public rmdirSync(path: string): void {
		if (!this.existsSync(path)) {
			throw ErrnoError.With('ENOENT', path, 'rmdir');
		}
		if (this.writable.existsSync(path)) {
			this.writable.rmdirSync(path);
		}
		if (!this.existsSync(path)) {
			return;
		}
		// Check if directory is empty.
		if (this.readdirSync(path).length) {
			throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		}
		this.journal.add('delete', path);
	}

	public async mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
		if (await this.exists(path)) throw ErrnoError.With('EEXIST', path, 'mkdir');
		await this.createParentDirectories(path);
		await this.writable.mkdir(path, mode, options);
	}

	public mkdirSync(path: string, mode: number, options: CreationOptions): void {
		if (this.existsSync(path)) throw ErrnoError.With('EEXIST', path, 'mkdir');
		this.createParentDirectoriesSync(path);
		this.writable.mkdirSync(path, mode, options);
	}

	public async readdir(path: string): Promise<string[]> {
		if (this.isDeleted(path) || !(await this.exists(path))) throw ErrnoError.With('ENOENT', path, 'readdir');

		const entries: string[] = (await this.readable.exists(path)) ? await this.readable.readdir(path) : [];

		if (await this.writable.exists(path))
			for (const entry of await this.writable.readdir(path)) {
				if (!entries.includes(entry)) entries.push(entry);
			}

		return entries.filter(entry => !this.isDeleted(join(path, entry)));
	}

	public readdirSync(path: string): string[] {
		if (this.isDeleted(path) || !this.existsSync(path)) throw ErrnoError.With('ENOENT', path, 'readdir');

		const entries: string[] = this.readable.existsSync(path) ? this.readable.readdirSync(path) : [];

		if (this.writable.existsSync(path))
			for (const entry of this.writable.readdirSync(path)) {
				if (!entries.includes(entry)) entries.push(entry);
			}

		return entries.filter(entry => !this.isDeleted(join(path, entry)));
	}

	public streamRead(path: string, options: StreamOptions): ReadableStream {
		return this.writable.existsSync(path) ? this.writable.streamRead(path, options) : this.readable.streamRead(path, options);
	}

	public streamWrite(path: string, options: StreamOptions): WritableStream {
		this.copyForWriteSync(path);
		return this.writable.streamWrite(path, options);
	}

	/**
	 * Create the needed parent directories on the writable storage should they not exist.
	 * Use modes from the read-only storage.
	 */
	private createParentDirectoriesSync(path: string): void {
		const toCreate: string[] = [];

		const silence = canary(ErrnoError.With('EDEADLK', path));
		for (let parent = dirname(path); !this.writable.existsSync(parent); parent = dirname(parent)) {
			toCreate.push(parent);
		}
		silence();

		if (toCreate.length) debug('COW: Creating parent directories: ' + toCreate.join(', '));

		for (const path of toCreate.reverse()) {
			const { uid, gid, mode } = this.statSync(path);
			this.writable.mkdirSync(path, mode, { uid, gid });
		}
	}

	/**
	 * Create the needed parent directories on the writable storage should they not exist.
	 * Use modes from the read-only storage.
	 */
	private async createParentDirectories(path: string): Promise<void> {
		const toCreate: string[] = [];

		const silence = canary(ErrnoError.With('EDEADLK', path));
		for (let parent = dirname(path); !(await this.writable.exists(parent)); parent = dirname(parent)) {
			toCreate.push(parent);
		}
		silence();

		if (toCreate.length) debug('COW: Creating parent directories: ' + toCreate.join(', '));

		for (const path of toCreate.reverse()) {
			const { uid, gid, mode } = await this.stat(path);
			await this.writable.mkdir(path, mode, { uid, gid });
		}
	}

	/**
	 * Helper function:
	 * - Ensures p is on writable before proceeding. Throws an error if it doesn't exist.
	 * - Calls f to perform operation on writable.
	 */
	private copyForWriteSync(path: string): void {
		if (!this.existsSync(path)) {
			throw ErrnoError.With('ENOENT', path, '[copyForWrite]');
		}
		if (!this.writable.existsSync(dirname(path))) {
			this.createParentDirectoriesSync(path);
		}
		if (!this.writable.existsSync(path)) {
			this.copyToWritableSync(path);
		}
	}

	private async copyForWrite(path: string): Promise<void> {
		if (!(await this.exists(path))) {
			throw ErrnoError.With('ENOENT', path, '[copyForWrite]');
		}

		if (!(await this.writable.exists(dirname(path)))) {
			await this.createParentDirectories(path);
		}

		if (!(await this.writable.exists(path))) {
			return this.copyToWritable(path);
		}
	}

	/**
	 * Copy from readable to writable storage.
	 * PRECONDITION: File does not exist on writable storage.
	 */
	private copyToWritableSync(path: string): void {
		const stats = this.statSync(path);
		stats.mode |= 0o222;
		if (stats.isDirectory()) {
			this.writable.mkdirSync(path, stats.mode, stats);
			for (const k of this.readable.readdirSync(path)) {
				this.copyToWritableSync(join(path, k));
			}
			return;
		}

		const data = new Uint8Array(stats.size);
		using readable = this.readable.openFileSync(path, 'r');
		readable.readSync(data);
		using writable = this.writable.createFileSync(path, 'w', stats.mode, stats);
		writable.writeSync(data);
	}

	private async copyToWritable(path: string): Promise<void> {
		const stats = await this.stat(path);
		stats.mode |= 0o222;
		if (stats.isDirectory()) {
			await this.writable.mkdir(path, stats.mode, stats);
			for (const k of await this.readable.readdir(path)) {
				await this.copyToWritable(join(path, k));
			}
			return;
		}

		const data = new Uint8Array(stats.size);
		await this.readable.read(path, data, 0, stats.size);
		await using writable = await this.writable.createFile(path, 'w', stats.mode, stats);
		await writable.write(data);
	}
}

/**
 * @hidden @deprecated use `CopyOnWriteFS`
 */
export class OverlayFS extends CopyOnWriteFS {}

const _CopyOnWrite = {
	name: 'CopyOnWrite',
	options: {
		writable: { type: 'object', required: true },
		readable: { type: 'object', required: true },
		journal: { type: 'object', required: false },
	},
	async create(options: CopyOnWriteOptions) {
		const readable = await resolveMountConfig(options.readable);
		const writable = await resolveMountConfig(options.writable);
		return new CopyOnWriteFS(readable, writable, options.journal);
	},
} as const satisfies Backend<CopyOnWriteFS, CopyOnWriteOptions>;
type _CopyOnWrite = typeof _CopyOnWrite;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CopyOnWrite extends _CopyOnWrite {}
/**
 * Overlay makes a read-only filesystem writable by storing writes on a second, writable file system.
 * Deletes are persisted via metadata stored on the writable file system.
 * @category Backends and Configuration
 * @internal
 */
export const CopyOnWrite: CopyOnWrite = _CopyOnWrite;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Overlay extends _CopyOnWrite {}

/**
 * @deprecated Use `CopyOnWrite`
 * @category Backends and Configuration
 * @internal @hidden
 */
export const Overlay: Overlay = _CopyOnWrite;
