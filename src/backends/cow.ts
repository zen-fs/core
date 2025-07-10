import type { CreationOptions, StreamOptions, UsageInfo } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import type { Backend } from './backend.js';

import { EventEmitter } from 'eventemitter3';
import { withErrno } from 'kerium';
import { debug, err, warn } from 'kerium/log';
import { canary } from 'utilium';
import { resolveMountConfig, type MountConfiguration } from '../config.js';
import { FileSystem } from '../internal/filesystem.js';
import { isDirectory } from '../internal/inode.js';
import { dirname, join } from '../path.js';

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

const journalOperations = ['delete'] as const;

/**
 * @category Internals
 * @internal
 */
export type JournalOperation = (typeof journalOperations)[number];

/** Because TS doesn't work right w/o it */
function isJournalOp(op: string): op is JournalOperation {
	return journalOperations.includes(op as any);
}

const maxOpLength = Math.max(...journalOperations.map(op => op.length));

/**
 * @category Internals
 * @internal
 */
export interface JournalEntry {
	path: string;
	op: JournalOperation;
}

const journalMagicString = '#journal@v0\n';

/**
 * Tracks various operations for the CoW backend
 * @category Internals
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
		if (!value.startsWith(journalMagicString)) throw err(withErrno('EINVAL', 'Invalid journal contents, refusing to parse'));

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
 * @category Internals
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
			throw err(withErrno('EINVAL', 'Writable file system can not be written to'));
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

	public async sync(): Promise<void> {
		await this.writable.sync();
	}

	public syncSync(): void {
		this.writable.syncSync();
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
			if (this.isDeleted(oldPath)) throw withErrno('ENOENT');
		}
	}

	public renameSync(oldPath: string, newPath: string): void {
		this.copyForWriteSync(oldPath);

		try {
			this.writable.renameSync(oldPath, newPath);
		} catch {
			if (this.isDeleted(oldPath)) throw withErrno('ENOENT');
		}
	}

	public async stat(path: string): Promise<InodeLike> {
		try {
			return await this.writable.stat(path);
		} catch {
			if (this.isDeleted(path)) throw withErrno('ENOENT');
			return await this.readable.stat(path);
		}
	}

	public statSync(path: string): InodeLike {
		try {
			return this.writable.statSync(path);
		} catch {
			if (this.isDeleted(path)) throw withErrno('ENOENT');
			return this.readable.statSync(path);
		}
	}

	public async touch(path: string, metadata: InodeLike): Promise<void> {
		await this.copyForWrite(path);
		await this.writable.touch(path, metadata);
	}

	public touchSync(path: string, metadata: InodeLike): void {
		this.copyForWriteSync(path);
		this.writable.touchSync(path, metadata);
	}

	public async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		await this.createParentDirectories(path);
		return await this.writable.createFile(path, options);
	}

	public createFileSync(path: string, options: CreationOptions): InodeLike {
		this.createParentDirectoriesSync(path);
		return this.writable.createFileSync(path, options);
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
		if (!(await this.exists(path))) throw withErrno('ENOENT');

		if (await this.writable.exists(path)) {
			await this.writable.unlink(path);
		}

		// if it still exists add to the delete log
		if (await this.exists(path)) {
			this.journal.add('delete', path);
		}
	}

	public unlinkSync(path: string): void {
		if (!this.existsSync(path)) throw withErrno('ENOENT');

		if (this.writable.existsSync(path)) {
			this.writable.unlinkSync(path);
		}

		// if it still exists add to the delete log
		if (this.existsSync(path)) {
			this.journal.add('delete', path);
		}
	}

	public async rmdir(path: string): Promise<void> {
		if (!(await this.exists(path))) throw withErrno('ENOENT');
		if (await this.writable.exists(path)) {
			await this.writable.rmdir(path);
		}
		if (!(await this.exists(path))) {
			return;
		}
		// Check if directory is empty.
		if ((await this.readdir(path)).length) throw withErrno('ENOTEMPTY');
		this.journal.add('delete', path);
	}

	public rmdirSync(path: string): void {
		if (!this.existsSync(path)) throw withErrno('ENOENT');
		if (this.writable.existsSync(path)) {
			this.writable.rmdirSync(path);
		}
		if (!this.existsSync(path)) {
			return;
		}
		// Check if directory is empty.
		if (this.readdirSync(path).length) throw withErrno('ENOTEMPTY');
		this.journal.add('delete', path);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		if (await this.exists(path)) throw withErrno('EEXIST');
		await this.createParentDirectories(path);
		return await this.writable.mkdir(path, options);
	}

	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		if (this.existsSync(path)) throw withErrno('EEXIST');
		this.createParentDirectoriesSync(path);
		return this.writable.mkdirSync(path, options);
	}

	public async readdir(path: string): Promise<string[]> {
		if (this.isDeleted(path) || !(await this.exists(path))) throw withErrno('ENOENT');

		const entries: string[] = (await this.readable.exists(path)) ? await this.readable.readdir(path) : [];

		if (await this.writable.exists(path))
			for (const entry of await this.writable.readdir(path)) {
				if (!entries.includes(entry)) entries.push(entry);
			}

		return entries.filter(entry => !this.isDeleted(join(path, entry)));
	}

	public readdirSync(path: string): string[] {
		if (this.isDeleted(path) || !this.existsSync(path)) throw withErrno('ENOENT');

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

		const silence = canary(withErrno('EDEADLK'));
		for (let parent = dirname(path); !this.writable.existsSync(parent); parent = dirname(parent)) {
			toCreate.push(parent);
		}
		silence();

		if (toCreate.length) debug('COW: Creating parent directories: ' + toCreate.join(', '));

		for (const path of toCreate.reverse()) {
			this.writable.mkdirSync(path, this.statSync(path));
		}
	}

	/**
	 * Create the needed parent directories on the writable storage should they not exist.
	 * Use modes from the read-only storage.
	 */
	private async createParentDirectories(path: string): Promise<void> {
		const toCreate: string[] = [];

		const silence = canary(withErrno('EDEADLK', path));
		for (let parent = dirname(path); !(await this.writable.exists(parent)); parent = dirname(parent)) {
			toCreate.push(parent);
		}
		silence();

		if (toCreate.length) debug('COW: Creating parent directories: ' + toCreate.join(', '));

		for (const path of toCreate.reverse()) {
			await this.writable.mkdir(path, await this.stat(path));
		}
	}

	/**
	 * Helper function:
	 * - Ensures p is on writable before proceeding. Throws an error if it doesn't exist.
	 * - Calls f to perform operation on writable.
	 */
	private copyForWriteSync(path: string): void {
		if (!this.existsSync(path)) throw withErrno('ENOENT');
		if (!this.writable.existsSync(dirname(path))) {
			this.createParentDirectoriesSync(path);
		}
		if (!this.writable.existsSync(path)) {
			this.copyToWritableSync(path);
		}
	}

	private async copyForWrite(path: string): Promise<void> {
		if (!(await this.exists(path))) throw withErrno('ENOENT');

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
		const stats = this.readable.statSync(path);
		if (isDirectory(stats)) {
			this.writable.mkdirSync(path, stats);
			for (const k of this.readable.readdirSync(path)) {
				this.copyToWritableSync(join(path, k));
			}
			return;
		}

		const data = new Uint8Array(stats.size);
		this.readable.readSync(path, data, 0, data.byteLength);
		this.writable.createFileSync(path, stats);
		this.writable.touchSync(path, stats);
		this.writable.writeSync(path, data, 0);
	}

	private async copyToWritable(path: string): Promise<void> {
		const stats = await this.readable.stat(path);
		if (isDirectory(stats)) {
			await this.writable.mkdir(path, stats);
			for (const k of await this.readable.readdir(path)) {
				await this.copyToWritable(join(path, k));
			}
			return;
		}

		const data = new Uint8Array(stats.size);
		await this.readable.read(path, data, 0, stats.size);
		await this.writable.createFile(path, stats);
		await this.writable.touch(path, stats);
		await this.writable.write(path, data, 0);
	}
}

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

/**
 * Overlay makes a read-only filesystem writable by storing writes on a second, writable file system.
 * Deletes are persisted via metadata stored on the writable file system.
 * @category Backends and Configuration
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CopyOnWrite extends _CopyOnWrite {}
/**
 * Overlay makes a read-only filesystem writable by storing writes on a second, writable file system.
 * Deletes are persisted via metadata stored on the writable file system.
 * @category Backends and Configuration
 * @internal
 */
export const CopyOnWrite: CopyOnWrite = _CopyOnWrite;
