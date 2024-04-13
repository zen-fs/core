import { FileSystem, Sync, FileSystemMetadata } from '../filesystem.js';
import { ApiError, ErrorCode } from '../ApiError.js';
import { File, PreloadFile, parseFlag } from '../file.js';
import type { Stats } from '../stats.js';
import { join } from '../emulation/path.js';
import { Cred, rootCred } from '../cred.js';
import type { Backend } from './backend.js';

/**
 * @internal
 */
type AsyncMethodName = {
	[K in keyof FileSystem]: FileSystem[K] extends (...args) => Promise<unknown> ? K : never;
}[keyof FileSystem];

/**
 * @internal
 */
type AsyncOperation = {
	[K in AsyncMethodName]: [K, ...Parameters<FileSystem[K]>];
}[AsyncMethodName];

/**
 * We define our own file to interpose on syncSync() for mirroring purposes.
 * @internal
 */
export class MirrorFile extends PreloadFile<AsyncMirrorFS> {
	constructor(fs: AsyncMirrorFS, path: string, flag: string, stat: Stats, data: Uint8Array) {
		super(fs, path, flag, stat, data);
	}

	public async sync(): Promise<void> {
		this.syncSync();
	}

	public syncSync(): void {
		if (this.isDirty()) {
			this.fs.syncSync(this.path, this._buffer, this.stats);
			this.resetDirty();
		}
	}

	public async close(): Promise<void> {
		this.closeSync();
	}

	public closeSync(): void {
		this.syncSync();
	}
}

/**
 * Configuration options for the AsyncMirror file system.
 */
export interface AsyncMirrorOptions {
	/**
	 * The synchronous file system to mirror the asynchronous file system to.
	 */
	sync: FileSystem;
	/**
	 * The asynchronous file system to mirror.
	 */
	async: FileSystem;
}

/**
 * AsyncMirrorFS mirrors a synchronous filesystem into an asynchronous filesystem
 * by:
 *
 * * Performing operations over the in-memory copy, while asynchronously pipelining them
 *   to the backing store.
 * * During application loading, the contents of the async file system can be reloaded into
 *   the synchronous store, if desired.
 *
 * The two stores will be kept in sync. The most common use-case is to pair a synchronous
 * in-memory filesystem with an asynchronous backing store.
 *
 */
export class AsyncMirrorFS extends Sync(FileSystem) {
	/**
	 * Queue of pending asynchronous operations.
	 */
	private _queue: AsyncOperation[] = [];
	private _queueRunning: boolean = false;
	private _sync: FileSystem;
	private _async: FileSystem;
	private _isInitialized: boolean = false;

	private _ready: Promise<void>;

	public async ready(): Promise<this> {
		await this._ready;
		return this;
	}

	/**
	 *
	 * Mirrors the synchronous file system into the asynchronous file system.
	 *
	 * @param sync The synchronous file system to mirror the asynchronous file system to.
	 * @param async The asynchronous file system to mirror.
	 */
	constructor({ sync, async }: AsyncMirrorOptions) {
		super();
		this._sync = sync;
		this._async = async;
		this._ready = this._initialize();
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: AsyncMirrorFS.name,
			synchronous: true,
			supportsProperties: this._sync.metadata().supportsProperties && this._async.metadata().supportsProperties,
		};
	}

	public syncSync(path: string, data: Uint8Array, stats: Readonly<Stats>): void {
		this._sync.syncSync(path, data, stats);

		this.queue('sync', path, data, stats);
	}

	public openFileSync(path: string, flag: string, cred: Cred): File {
		return this._sync.openFileSync(path, flag, cred);
	}

	public createFileSync(path: string, flag: string, mode: number, cred: Cred): MirrorFile {
		const file = this._sync.createFileSync(path, flag, mode, cred);
		this.queue('createFile', path, flag, mode, cred);
		const stats = file.statSync();
		const buffer = new Uint8Array(stats.size);
		file.readSync(buffer);
		return new MirrorFile(this, path, flag, stats, buffer);
	}

	public linkSync(srcpath: string, dstpath: string, cred: Cred): void {
		this._sync.linkSync(srcpath, dstpath, cred);
		this.queue('link', srcpath, dstpath, cred);
	}

	public renameSync(oldPath: string, newPath: string, cred: Cred): void {
		this._sync.renameSync(oldPath, newPath, cred);
		this.queue('rename', oldPath, newPath, cred);
	}

	public statSync(p: string, cred: Cred): Stats {
		return this._sync.statSync(p, cred);
	}

	public unlinkSync(p: string, cred: Cred): void {
		this._sync.unlinkSync(p, cred);
		this.queue('unlink', p, cred);
	}

	public rmdirSync(p: string, cred: Cred): void {
		this._sync.rmdirSync(p, cred);
		this.queue('rmdir', p, cred);
	}

	public mkdirSync(p: string, mode: number, cred: Cred): void {
		this._sync.mkdirSync(p, mode, cred);
		this.queue('mkdir', p, mode, cred);
	}

	public readdirSync(p: string, cred: Cred): string[] {
		return this._sync.readdirSync(p, cred);
	}

	public existsSync(p: string, cred: Cred): boolean {
		return this._sync.existsSync(p, cred);
	}

	/**
	 * @internal
	 */
	protected async crossCopyDirectory(p: string, mode: number): Promise<void> {
		if (p !== '/') {
			const stats = await this._async.stat(p, rootCred);
			this._sync.mkdirSync(p, mode, stats.cred());
		}
		const files = await this._async.readdir(p, rootCred);
		for (const file of files) {
			await this.crossCopy(join(p, file));
		}
	}

	/**
	 * @internal
	 */
	protected async crossCopyFile(p: string, mode: number): Promise<void> {
		const asyncFile = await this._async.openFile(p, parseFlag('r'), rootCred);
		const syncFile = this._sync.createFileSync(p, parseFlag('w'), mode, rootCred);
		try {
			const { size } = await asyncFile.stat();
			const buffer = new Uint8Array(size);
			await asyncFile.read(buffer);
			syncFile.writeSync(buffer);
		} finally {
			await asyncFile.close();
			syncFile.closeSync();
		}
	}

	/**
	 * @internal
	 */
	protected async crossCopy(p: string): Promise<void> {
		const stats = await this._async.stat(p, rootCred);
		if (stats.isDirectory()) {
			await this.crossCopyDirectory(p, stats.mode);
		} else {
			await this.crossCopyFile(p, stats.mode);
		}
	}

	/**
	 * Called once to load up files from async storage into sync storage.
	 */
	protected async _initialize(): Promise<void> {
		if (this._isInitialized) {
			return;
		}

		try {
			await this.crossCopy('/');
			this._isInitialized = true;
		} catch (e) {
			this._isInitialized = false;
			throw e;
		}
	}

	/**
	 * @internal
	 */
	private async _next(): Promise<void> {
		if (this._queue.length == 0) {
			this._queueRunning = false;
			return;
		}

		const [method, ...args] = this._queue.shift()!;
		// @ts-expect-error 2556 (since ...args is not correctly picked up as being a tuple)
		await this._async[method](...args);
		await this._next();
	}

	/**
	 * @internal
	 */
	private queue(...op: AsyncOperation) {
		this._queue.push(op);
		if (this._queueRunning) {
			return;
		}

		this._queueRunning = true;
		this._next();
	}
}

export const AsyncMirror: Backend<AsyncMirrorFS> = {
	name: 'AsyncMirror',

	options: {
		sync: {
			type: 'object',
			required: true,
			description: 'The synchronous file system to mirror the asynchronous file system to.',
			validator: async (backend: FileSystem | Backend): Promise<void> => {
				if ('metadata' in backend && !backend.metadata().synchronous) {
					throw new ApiError(ErrorCode.EINVAL, '"sync" option must be a file system that supports synchronous operations');
				}
			},
		},
		async: {
			type: 'object',
			required: true,
			description: 'The asynchronous file system to mirror.',
		},
	},

	isAvailable(): boolean {
		return true;
	},

	create(options: AsyncMirrorOptions): AsyncMirrorFS {
		return new AsyncMirrorFS(options);
	},
};
