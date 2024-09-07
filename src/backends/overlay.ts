import type { FileSystemMetadata } from '../filesystem.js';
import { FileSystem } from '../filesystem.js';
import { ErrnoError, Errno } from '../error.js';
import type { File } from '../file.js';
import { PreloadFile, parseFlag } from '../file.js';
import { Stats } from '../stats.js';
import { MutexedFS } from './mutexed.js';
import { dirname } from '../emulation/path.js';
import type { Cred } from '../cred.js';
import { rootCred } from '../cred.js';
import { decode, encode } from '../utils.js';
import type { Backend } from './backend.js';
/**
 * @internal
 */
const deletionLogPath = '/.deleted';

/**
 * Configuration options for OverlayFS instances.
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
export class UnmutexedOverlayFS extends FileSystem {
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

	constructor({ writable, readable }: OverlayOptions) {
		super();
		this.writable = writable;
		this.readable = readable;
		if (this.writable.metadata().readonly) {
			throw new ErrnoError(Errno.EINVAL, 'Writable file system must be writable.');
		}
		this._ready = this._initialize();
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: OverlayFS.name,
		};
	}

	public async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		const cred = stats.cred(0, 0);
		await this.createParentDirectories(path, cred);
		if (!(await this.writable.exists(path, cred))) {
			await this.writable.createFile(path, 'w', 0o644, cred);
		}
		await this.writable.sync(path, data, stats);
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		const cred = stats.cred(0, 0);
		this.createParentDirectoriesSync(path, cred);
		this.writable.syncSync(path, data, stats);
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
			const file = await this.writable.openFile(deletionLogPath, parseFlag('r'), rootCred);
			const { size } = await file.stat();
			const { buffer } = await file.read(new Uint8Array(size));
			this._deleteLog = decode(buffer);
		} catch (err) {
			if ((err as ErrnoError).errno !== Errno.ENOENT) {
				throw err;
			}
		}
		this._isInitialized = true;
		this._reparseDeletionLog();
	}

	public getDeletionLog(): string {
		return this._deleteLog;
	}

	public async restoreDeletionLog(log: string, cred: Cred): Promise<void> {
		this._deleteLog = log;
		this._reparseDeletionLog();
		await this.updateLog('', cred);
	}

	public async rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		this.checkInitialized();
		this.checkPath(oldPath);
		this.checkPath(newPath);

		try {
			await this.writable.rename(oldPath, newPath, cred);
		} catch (e) {
			if (this._deletedFiles.has(oldPath)) {
				throw ErrnoError.With('ENOENT', oldPath, 'rename');
			}
		}
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		this.checkInitialized();
		this.checkPath(oldPath);
		this.checkPath(newPath);

		try {
			this.writable.renameSync(oldPath, newPath, cred);
		} catch (e) {
			if (this._deletedFiles.has(oldPath)) {
				throw ErrnoError.With('ENOENT', oldPath, 'rename');
			}
		}
	}

	public async stat(path: string, cred: Cred): Promise<Stats> {
		this.checkInitialized();
		try {
			return await this.writable.stat(path, cred);
		} catch (e) {
			if (this._deletedFiles.has(path)) {
				throw ErrnoError.With('ENOENT', path, 'stat');
			}
			const oldStat = new Stats(await this.readable.stat(path, cred));
			// Make the oldStat's mode writable. Preserve the topmost part of the mode, which specifies the type
			oldStat.mode |= 0o222;
			return oldStat;
		}
	}

	public statSync(path: string, cred: Cred): Stats {
		this.checkInitialized();
		try {
			return this.writable.statSync(path, cred);
		} catch (e) {
			if (this._deletedFiles.has(path)) {
				throw ErrnoError.With('ENOENT', path, 'stat');
			}
			const oldStat = new Stats(this.readable.statSync(path, cred));
			// Make the oldStat's mode writable. Preserve the topmost part of the mode, which specifies the type.
			oldStat.mode |= 0o222;
			return oldStat;
		}
	}

	public async openFile(path: string, flag: string, cred: Cred): Promise<File> {
		if (await this.writable.exists(path, cred)) {
			return this.writable.openFile(path, flag, cred);
		}
		// Create an OverlayFile.
		const file = await this.readable.openFile(path, parseFlag('r'), cred);
		const stats = new Stats(await file.stat());
		const { buffer } = await file.read(new Uint8Array(stats.size));
		return new PreloadFile(this, path, flag, stats, buffer);
	}

	public openFileSync(path: string, flag: string, cred: Cred): File {
		if (this.writable.existsSync(path, cred)) {
			return this.writable.openFileSync(path, flag, cred);
		}
		// Create an OverlayFile.
		const file = this.readable.openFileSync(path, parseFlag('r'), cred);
		const stats = new Stats(file.statSync());
		const data = new Uint8Array(stats.size);
		file.readSync(data);
		return new PreloadFile(this, path, flag, stats, data);
	}

	public async createFile(path: string, flag: string, mode: number, cred: Cred): Promise<File> {
		this.checkInitialized();
		await this.writable.createFile(path, flag, mode, cred);
		return this.openFile(path, flag, cred);
	}

	public createFileSync(path: string, flag: string, mode: number, cred: Cred): File {
		this.checkInitialized();
		this.writable.createFileSync(path, flag, mode, cred);
		return this.openFileSync(path, flag, cred);
	}

	public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		this.checkInitialized();
		await this.writable.link(srcpath, dstpath, cred);
	}

	public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
		this.checkInitialized();
		this.writable.linkSync(srcpath, dstpath, cred);
	}

	public async unlink(path: string, cred: Cred): Promise<void> {
		this.checkInitialized();
		this.checkPath(path);
		if (!(await this.exists(path, cred))) {
			throw ErrnoError.With('ENOENT', path, 'unlink');
		}

		if (await this.writable.exists(path, cred)) {
			await this.writable.unlink(path, cred);
		}

		// if it still exists add to the delete log
		if (await this.exists(path, cred)) {
			await this.deletePath(path, cred);
		}
	}

	public unlinkSync(path: string, cred: Cred): void {
		this.checkInitialized();
		this.checkPath(path);
		if (!this.existsSync(path, cred)) {
			throw ErrnoError.With('ENOENT', path, 'unlink');
		}

		if (this.writable.existsSync(path, cred)) {
			this.writable.unlinkSync(path, cred);
		}

		// if it still exists add to the delete log
		if (this.existsSync(path, cred)) {
			void this.deletePath(path, cred);
		}
	}

	public async rmdir(path: string, cred: Cred): Promise<void> {
		this.checkInitialized();
		if (!(await this.exists(path, cred))) {
			throw ErrnoError.With('ENOENT', path, 'rmdir');
		}
		if (await this.writable.exists(path, cred)) {
			await this.writable.rmdir(path, cred);
		}
		if (await this.exists(path, cred)) {
			// Check if directory is empty.
			if ((await this.readdir(path, cred)).length > 0) {
				throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
			} else {
				await this.deletePath(path, cred);
			}
		}
	}

	public rmdirSync(path: string, cred: Cred): void {
		this.checkInitialized();
		if (!this.existsSync(path, cred)) {
			throw ErrnoError.With('ENOENT', path, 'rmdir');
		}
		if (this.writable.existsSync(path, cred)) {
			this.writable.rmdirSync(path, cred);
		}
		if (this.existsSync(path, cred)) {
			// Check if directory is empty.
			if (this.readdirSync(path, cred).length > 0) {
				throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
			} else {
				void this.deletePath(path, cred);
			}
		}
	}

	public async mkdir(path: string, mode: number, cred: Cred): Promise<void> {
		this.checkInitialized();
		if (await this.exists(path, cred)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}
		// The below will throw should any of the parent directories fail to exist on _writable.
		await this.createParentDirectories(path, cred);
		await this.writable.mkdir(path, mode, cred);
	}

	public mkdirSync(path: string, mode: number, cred: Cred): void {
		this.checkInitialized();
		if (this.existsSync(path, cred)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}
		// The below will throw should any of the parent directories fail to exist on _writable.
		this.createParentDirectoriesSync(path, cred);
		this.writable.mkdirSync(path, mode, cred);
	}

	public async readdir(path: string, cred: Cred): Promise<string[]> {
		this.checkInitialized();
		const dirStats = await this.stat(path, cred);
		if (!dirStats.isDirectory()) {
			throw ErrnoError.With('ENOTDIR', path, 'readdir');
		}

		// Readdir in both, check delete log on RO file system's listing, merge, return.
		const contents: string[] = [];
		try {
			contents.push(...(await this.writable.readdir(path, cred)));
		} catch (e) {
			// NOP.
		}
		try {
			contents.push(...(await this.readable.readdir(path, cred)).filter((fPath: string) => !this._deletedFiles.has(`${path}/${fPath}`)));
		} catch (e) {
			// NOP.
		}
		const seenMap: { [name: string]: boolean } = {};
		return contents.filter((path: string) => {
			const result = !seenMap[path];
			seenMap[path] = true;
			return result;
		});
	}

	public readdirSync(path: string, cred: Cred): string[] {
		this.checkInitialized();
		const dirStats = this.statSync(path, cred);
		if (!dirStats.isDirectory()) {
			throw ErrnoError.With('ENOTDIR', path, 'readdir');
		}

		// Readdir in both, check delete log on RO file system's listing, merge, return.
		let contents: string[] = [];
		try {
			contents = contents.concat(this.writable.readdirSync(path, cred));
		} catch (e) {
			// NOP.
		}
		try {
			contents = contents.concat(this.readable.readdirSync(path, cred).filter((fPath: string) => !this._deletedFiles.has(`${path}/${fPath}`)));
		} catch (e) {
			// NOP.
		}
		const seenMap: { [name: string]: boolean } = {};
		return contents.filter((path: string) => {
			const result = !seenMap[path];
			seenMap[path] = true;
			return result;
		});
	}

	private async deletePath(path: string, cred: Cred): Promise<void> {
		this._deletedFiles.add(path);
		await this.updateLog(`d${path}\n`, cred);
	}

	private async updateLog(addition: string, cred: Cred) {
		this._deleteLog += addition;
		if (this._deleteLogUpdatePending) {
			this._deleteLogUpdateNeeded = true;
			return;
		}
		this._deleteLogUpdatePending = true;
		const log = await this.writable.openFile(deletionLogPath, parseFlag('w'), cred);
		try {
			await log.write(encode(this._deleteLog));
			if (this._deleteLogUpdateNeeded) {
				this._deleteLogUpdateNeeded = false;
				await this.updateLog('', cred);
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
			throw new ErrnoError(Errno.EPERM, 'OverlayFS is not initialized. Please initialize OverlayFS using its initialize() method before using it.');
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
	 * With the given path, create the needed parent directories on the writable storage
	 * should they not exist. Use modes from the read-only storage.
	 */
	private createParentDirectoriesSync(path: string, cred: Cred): void {
		let parent = dirname(path),
			toCreate: string[] = [];
		while (!this.writable.existsSync(parent, cred)) {
			toCreate.push(parent);
			parent = dirname(parent);
		}
		toCreate = toCreate.reverse();

		for (const p of toCreate) {
			this.writable.mkdirSync(p, this.statSync(p, cred).mode, cred);
		}
	}

	private async createParentDirectories(path: string, cred: Cred): Promise<void> {
		let parent = dirname(path),
			toCreate: string[] = [];
		while (!(await this.writable.exists(parent, cred))) {
			toCreate.push(parent);
			parent = dirname(parent);
		}
		toCreate = toCreate.reverse();

		for (const p of toCreate) {
			const stats = await this.stat(p, cred);
			await this.writable.mkdir(p, stats.mode, cred);
		}
	}

	/**
	 * Helper function:
	 * - Ensures p is on writable before proceeding. Throws an error if it doesn't exist.
	 * - Calls f to perform operation on writable.
	 */
	private operateOnWritable(path: string, cred: Cred): void {
		if (!this.existsSync(path, cred)) {
			throw ErrnoError.With('ENOENT', path, 'operateOnWriteable');
		}
		if (!this.writable.existsSync(path, cred)) {
			// File is on readable storage. Copy to writable storage before
			// changing its mode.
			this.copyToWritableSync(path, cred);
		}
	}

	private async operateOnWritableAsync(path: string, cred: Cred): Promise<void> {
		if (!(await this.exists(path, cred))) {
			throw ErrnoError.With('ENOENT', path, 'operateOnWritable');
		}

		if (!(await this.writable.exists(path, cred))) {
			return this.copyToWritable(path, cred);
		}
	}

	/**
	 * Copy from readable to writable storage.
	 * PRECONDITION: File does not exist on writable storage.
	 */
	private copyToWritableSync(path: string, cred: Cred): void {
		const stats = this.statSync(path, cred);
		if (stats.isDirectory()) {
			this.writable.mkdirSync(path, stats.mode, cred);
			return;
		}

		const data = new Uint8Array(stats.size);
		const readable = this.readable.openFileSync(path, parseFlag('r'), cred);
		readable.readSync(data);
		readable.closeSync();
		const writable = this.writable.openFileSync(path, parseFlag('w'), cred);
		writable.writeSync(data);
		writable.closeSync();
	}

	private async copyToWritable(path: string, cred: Cred): Promise<void> {
		const stats = await this.stat(path, cred);
		if (stats.isDirectory()) {
			await this.writable.mkdir(path, stats.mode, cred);
			return;
		}

		const data = new Uint8Array(stats.size);
		const readable = await this.readable.openFile(path, parseFlag('r'), cred);
		await readable.read(data);
		await readable.close();
		const writable = await this.writable.openFile(path, parseFlag('w'), cred);
		await writable.write(data);
		await writable.close();
	}
}

/**
 * OverlayFS makes a read-only filesystem writable by storing writes on a second,
 * writable file system. Deletes are persisted via metadata stored on the writable
 * file system.
 * @internal
 */
export class OverlayFS extends MutexedFS<UnmutexedOverlayFS> {
	/**
	 * @param options The options to initialize the OverlayFS with
	 */
	constructor(options: OverlayOptions) {
		super(new UnmutexedOverlayFS(options));
	}

	public get readable() {
		return this.fs.readable;
	}

	public get writable() {
		return this.fs.writable;
	}

	public getDeletionLog(): string {
		return super.fs.getDeletionLog();
	}

	public resDeletionLog(): string {
		return super.fs.getDeletionLog();
	}

	public unwrap(): UnmutexedOverlayFS {
		return super.fs;
	}
}

const _Overlay = {
	name: 'Overlay',

	options: {
		writable: {
			type: 'object',
			required: true,
			description: 'The file system to write modified files to.',
		},
		readable: {
			type: 'object',
			required: true,
			description: 'The file system that initially populates this file system.',
		},
	},

	isAvailable(): boolean {
		return true;
	},

	create(options: OverlayOptions) {
		return new OverlayFS(options);
	},
} as const satisfies Backend<OverlayFS, OverlayOptions>;
type _overlay = typeof _Overlay;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Overlay extends _overlay {}
export const Overlay: Overlay = _Overlay;
