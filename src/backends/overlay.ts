import type { File } from '../internal/file.js';
import type { CreationOptions } from '../internal/filesystem.js';
import type { Stats } from '../stats.js';
import type { Backend } from './backend.js';
import type { InodeLike } from '../internal/inode.js';

import { canary } from 'utilium';
import { Errno, ErrnoError } from '../internal/error.js';
import { LazyFile, parseFlag } from '../internal/file.js';
import { FileSystem } from '../internal/filesystem.js';
import { crit, err, info } from '../internal/log.js';
import { decodeUTF8, encodeUTF8 } from '../utils.js';
import { dirname, join } from '../vfs/path.js';

/** @internal */
const deletionLogPath = '/.deleted';

/**
 * Configuration options for OverlayFS instances.
 * @category Backends and Configuration
 */
export interface OverlayOptions {
	/**
	 * The file system to write modified files to.
	 */
	writable: FileSystem;
	/**
	 * The file system that initially populates this file system.
	 */
	readable: FileSystem;
}

/**
 * OverlayFS makes a read-only filesystem writable by storing writes on a second, writable file system.
 * Deletes are persisted via metadata stored on the writable file system.
 *
 * This class contains no locking whatsoever. It is mutexed to prevent races.
 *
 * @internal
 */
export class OverlayFS extends FileSystem {
	async ready(): Promise<void> {
		await this.readable.ready();
		await this.writable.ready();
		await this._ready;
	}

	public readonly writable: FileSystem;
	public readonly readable: FileSystem;
	private _isInitialized: boolean = false;
	private _deletedFiles: Set<string> = new Set();
	private _deleteLog: string = '';
	// If 'true', we have scheduled a delete log update.
	private _deleteLogUpdatePending: boolean = false;
	// If 'true', a delete log update is needed after the scheduled delete log
	// update finishes.
	private _deleteLogUpdateNeeded: boolean = false;
	// If there was an error updating the delete log...
	private _deleteLogError?: ErrnoError;

	private _ready: Promise<void>;

	public constructor({ writable, readable }: OverlayOptions) {
		super(0x62756c6c, readable.name);
		this.writable = writable;
		this.readable = readable;
		if (this.writable.attributes.has('no_write')) {
			throw err(new ErrnoError(Errno.EINVAL, 'Writable file can not be written to'));
		}
		this._ready = this._initialize();
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

	/**
	 * Called once to load up metadata stored on the writable file system.
	 * @internal
	 */
	public async _initialize(): Promise<void> {
		if (this._isInitialized) {
			return;
		}

		// Read deletion log, process into metadata.
		try {
			const file = await this.writable.openFile(deletionLogPath, parseFlag('r'));
			const { size } = await file.stat();
			const { buffer } = await file.read(new Uint8Array(size));
			this._deleteLog = decodeUTF8(buffer);
		} catch (error: any) {
			if (error.errno !== Errno.ENOENT) throw err(error);
			info('Overlay does not have a deletion log');
		}
		this._isInitialized = true;
		this._reparseDeletionLog();
	}

	public getDeletionLog(): string {
		return this._deleteLog;
	}

	public async restoreDeletionLog(log: string): Promise<void> {
		this._deleteLog = log;
		this._reparseDeletionLog();
		await this.updateLog('');
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		this.checkInitialized();
		this.checkPath(oldPath);
		this.checkPath(newPath);

		await this.copyForWrite(oldPath);

		try {
			await this.writable.rename(oldPath, newPath);
		} catch {
			if (this._deletedFiles.has(oldPath)) {
				throw ErrnoError.With('ENOENT', oldPath, 'rename');
			}
		}
	}

	public renameSync(oldPath: string, newPath: string): void {
		this.checkInitialized();
		this.checkPath(oldPath);
		this.checkPath(newPath);

		this.copyForWriteSync(oldPath);

		try {
			this.writable.renameSync(oldPath, newPath);
		} catch {
			if (this._deletedFiles.has(oldPath)) {
				throw ErrnoError.With('ENOENT', oldPath, 'rename');
			}
		}
	}

	public async stat(path: string): Promise<Stats> {
		this.checkInitialized();
		try {
			return await this.writable.stat(path);
		} catch {
			if (this._deletedFiles.has(path)) {
				throw ErrnoError.With('ENOENT', path, 'stat');
			}
			const oldStat = await this.readable.stat(path);
			// Make the oldStat's mode writable.
			oldStat.mode |= 0o222;
			return oldStat;
		}
	}

	public statSync(path: string): Stats {
		this.checkInitialized();
		try {
			return this.writable.statSync(path);
		} catch {
			if (this._deletedFiles.has(path)) {
				throw ErrnoError.With('ENOENT', path, 'stat');
			}
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
		this.checkInitialized();
		await this.writable.createFile(path, flag, mode, options);
		return this.openFile(path, flag);
	}

	public createFileSync(path: string, flag: string, mode: number, options: CreationOptions): File {
		this.checkInitialized();
		this.writable.createFileSync(path, flag, mode, options);
		return this.openFileSync(path, flag);
	}

	public async link(srcpath: string, dstpath: string): Promise<void> {
		this.checkInitialized();
		await this.copyForWrite(srcpath);
		await this.writable.link(srcpath, dstpath);
	}

	public linkSync(srcpath: string, dstpath: string): void {
		this.checkInitialized();
		this.copyForWriteSync(srcpath);
		this.writable.linkSync(srcpath, dstpath);
	}

	public async unlink(path: string): Promise<void> {
		this.checkInitialized();
		this.checkPath(path);
		if (!(await this.exists(path))) {
			throw ErrnoError.With('ENOENT', path, 'unlink');
		}

		if (await this.writable.exists(path)) {
			await this.writable.unlink(path);
		}

		// if it still exists add to the delete log
		if (await this.exists(path)) {
			await this.deletePath(path);
		}
	}

	public unlinkSync(path: string): void {
		this.checkInitialized();
		this.checkPath(path);
		if (!this.existsSync(path)) {
			throw ErrnoError.With('ENOENT', path, 'unlink');
		}

		if (this.writable.existsSync(path)) {
			this.writable.unlinkSync(path);
		}

		// if it still exists add to the delete log
		if (this.existsSync(path)) {
			void this.deletePath(path);
		}
	}

	public async rmdir(path: string): Promise<void> {
		this.checkInitialized();
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
		await this.deletePath(path);
	}

	public rmdirSync(path: string): void {
		this.checkInitialized();
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
		void this.deletePath(path);
	}

	public async mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
		this.checkInitialized();
		if (await this.exists(path)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}
		// The below will throw should any of the parent directories fail to exist on _writable.
		await this.createParentDirectories(path);
		await this.writable.mkdir(path, mode, options);
	}

	public mkdirSync(path: string, mode: number, options: CreationOptions): void {
		this.checkInitialized();
		if (this.existsSync(path)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}
		// The below will throw should any of the parent directories fail to exist on _writable.
		this.createParentDirectoriesSync(path);
		this.writable.mkdirSync(path, mode, options);
	}

	public async readdir(path: string): Promise<string[]> {
		this.checkInitialized();

		// Readdir in both, check delete log on RO file system's listing, merge, return.
		const contents: string[] = [];
		try {
			contents.push(...(await this.writable.readdir(path)));
		} catch {
			// NOP.
		}
		try {
			contents.push(...(await this.readable.readdir(path)).filter((fPath: string) => !this._deletedFiles.has(`${path}/${fPath}`)));
		} catch {
			// NOP.
		}
		const seenMap: { [name: string]: boolean } = {};
		return contents.filter((path: string) => {
			const result = !seenMap[path];
			seenMap[path] = true;
			return result;
		});
	}

	public readdirSync(path: string): string[] {
		this.checkInitialized();

		// Readdir in both, check delete log on RO file system's listing, merge, return.
		let contents: string[] = [];
		try {
			contents = contents.concat(this.writable.readdirSync(path));
		} catch {
			// NOP.
		}
		try {
			contents = contents.concat(this.readable.readdirSync(path).filter((fPath: string) => !this._deletedFiles.has(`${path}/${fPath}`)));
		} catch {
			// NOP.
		}
		const seenMap: { [name: string]: boolean } = {};
		return contents.filter((path: string) => {
			const result = !seenMap[path];
			seenMap[path] = true;
			return result;
		});
	}

	private async deletePath(path: string): Promise<void> {
		this._deletedFiles.add(path);
		await this.updateLog(`d${path}\n`);
	}

	private async updateLog(addition: string) {
		this._deleteLog += addition;
		if (this._deleteLogUpdatePending) {
			this._deleteLogUpdateNeeded = true;
			return;
		}
		this._deleteLogUpdatePending = true;
		const log = await this.writable.openFile(deletionLogPath, parseFlag('w'));
		try {
			await log.write(encodeUTF8(this._deleteLog));
			if (this._deleteLogUpdateNeeded) {
				this._deleteLogUpdateNeeded = false;
				await this.updateLog('');
			}
		} catch (e) {
			this._deleteLogError = e as ErrnoError;
		} finally {
			this._deleteLogUpdatePending = false;
		}
	}

	private _reparseDeletionLog(): void {
		this._deletedFiles.clear();
		for (const entry of this._deleteLog.split('\n')) {
			if (!entry.startsWith('d')) {
				continue;
			}

			// If the log entry begins w/ 'd', it's a deletion.

			this._deletedFiles.add(entry.slice(1));
		}
	}

	private checkInitialized(): void {
		if (!this._isInitialized) {
			throw crit(new ErrnoError(Errno.EPERM, 'Overlay is not initialized'), { fs: this });
		}

		if (!this._deleteLogError) {
			return;
		}

		const error = this._deleteLogError;
		delete this._deleteLogError;
		throw error;
	}

	private checkPath(path: string): void {
		if (path == deletionLogPath) {
			throw ErrnoError.With('EPERM', path, 'checkPath');
		}
	}

	/**
	 * Create the needed parent directories on the writable storage should they not exist.
	 * Use modes from the read-only storage.
	 */
	private createParentDirectoriesSync(path: string): void {
		let parent = dirname(path);
		const toCreate: string[] = [];

		const silence = canary(ErrnoError.With('EDEADLK', path));
		while (!this.writable.existsSync(parent)) {
			toCreate.push(parent);
			parent = dirname(parent);
		}
		silence();

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
		let parent = dirname(path);
		const toCreate: string[] = [];

		const silence = canary(ErrnoError.With('EDEADLK', path));
		while (!(await this.writable.exists(parent))) {
			toCreate.push(parent);
			parent = dirname(parent);
		}
		silence();

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
		await using readable = await this.readable.openFile(path, 'r');
		await readable.read(data);
		await using writable = await this.writable.createFile(path, 'w', stats.mode, stats);
		await writable.write(data);
	}
}

const _Overlay = {
	name: 'Overlay',
	options: {
		writable: { type: 'object', required: true },
		readable: { type: 'object', required: true },
	},
	create(options: OverlayOptions) {
		return new OverlayFS(options);
	},
} as const satisfies Backend<OverlayFS, OverlayOptions>;
type _Overlay = typeof _Overlay;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Overlay extends _Overlay {}

/**
 * Overlay makes a read-only filesystem writable by storing writes on a second, writable file system.
 * Deletes are persisted via metadata stored on the writable file system.
 * @category Backends and Configuration
 * @internal
 */
export const Overlay: Overlay = _Overlay;
