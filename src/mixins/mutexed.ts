// SPDX-License-Identifier: LGPL-3.0-or-later
import type { UUID } from 'node:crypto';
import type { Concrete } from 'utilium';
import type { CreationOptions, FileSystem, StreamOptions, UsageInfo } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';

import { withErrno } from 'kerium';
import { err } from 'kerium/log';
import '../polyfills.js';

/**
 * @category Internals
 * @internal
 */
export class MutexLock {
	protected current = Promise.withResolvers<void>();

	protected _isLocked: boolean = true;
	public get isLocked(): boolean {
		return this._isLocked;
	}

	public constructor(protected readonly previous?: MutexLock) {}

	public async done(): Promise<void> {
		await this.previous?.done();
		await this.current.promise;
	}

	public unlock(): void {
		this.current.resolve();
		this._isLocked = false;
	}

	public [Symbol.dispose](): void {
		this.unlock();
	}
}

/**
 * @hidden
 * @category Internals
 */
export class _MutexedFS<T extends FileSystem> implements FileSystem {
	/**
	 * @internal
	 */
	public _fs!: T;

	public get type(): number {
		return this._fs.type;
	}

	public get name(): string {
		return this._fs.name;
	}

	public get label(): string | undefined {
		return this._fs.label;
	}

	public set label(value: string | undefined) {
		this._fs.label = value;
	}

	public get attributes() {
		return this._fs.attributes;
	}

	get _uuid(): UUID {
		return this._fs._uuid;
	}

	set _uuid(value: UUID) {
		this._fs._uuid = value;
	}

	public get uuid(): UUID {
		return this._fs.uuid;
	}

	public async ready(): Promise<void> {
		return await this._fs.ready();
	}

	public readySync(): void {
		return this._fs.readySync();
	}

	public usage(): UsageInfo {
		return this._fs.usage();
	}

	/**
	 * The current locks
	 */
	private currentLock?: MutexLock;

	/**
	 * Adds a lock for a path
	 */
	protected addLock(): MutexLock {
		const lock = new MutexLock(this.currentLock);
		this.currentLock = lock;
		return lock;
	}

	/**
	 * Locks `path` asynchronously.
	 * If the path is currently locked, waits for it to be unlocked.
	 * @internal
	 */
	public async lock(timeout: number = 5000): Promise<MutexLock> {
		const previous = this.currentLock;
		const lock = this.addLock();
		const stack = new Error().stack;
		setTimeout(() => {
			if (lock.isLocked) {
				const error = withErrno('EDEADLK');
				error.stack += stack?.slice('Error'.length);
				throw err(error);
			}
		}, timeout);
		await previous?.done();
		return lock;
	}

	/**
	 * Locks `path` asynchronously.
	 * If the path is currently locked, an error will be thrown
	 * @internal
	 */
	public lockSync(): MutexLock {
		if (this.currentLock?.isLocked) {
			throw err(withErrno('EBUSY'));
		}

		return this.addLock();
	}

	/**
	 * Whether `path` is locked
	 * @internal
	 */
	public get isLocked(): boolean {
		return !!this.currentLock?.isLocked;
	}

	/* eslint-disable @typescript-eslint/no-unused-vars */
	public async rename(oldPath: string, newPath: string): Promise<void> {
		using _ = await this.lock();
		await this._fs.rename(oldPath, newPath);
	}

	public renameSync(oldPath: string, newPath: string): void {
		using _ = this.lockSync();
		return this._fs.renameSync(oldPath, newPath);
	}

	public async stat(path: string): Promise<InodeLike> {
		using _ = await this.lock();
		return await this._fs.stat(path);
	}

	public statSync(path: string): InodeLike {
		using _ = this.lockSync();
		return this._fs.statSync(path);
	}

	public async touch(path: string, metadata: InodeLike): Promise<void> {
		using _ = await this.lock();
		await this._fs.touch(path, metadata);
	}

	public touchSync(path: string, metadata: InodeLike): void {
		using _ = this.lockSync();
		this._fs.touchSync(path, metadata);
	}

	public async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		using _ = await this.lock();
		return await this._fs.createFile(path, options);
	}

	public createFileSync(path: string, options: CreationOptions): InodeLike {
		using _ = this.lockSync();
		return this._fs.createFileSync(path, options);
	}

	public async unlink(path: string): Promise<void> {
		using _ = await this.lock();
		await this._fs.unlink(path);
	}

	public unlinkSync(path: string): void {
		using _ = this.lockSync();
		return this._fs.unlinkSync(path);
	}

	public async rmdir(path: string): Promise<void> {
		using _ = await this.lock();
		await this._fs.rmdir(path);
	}

	public rmdirSync(path: string): void {
		using _ = this.lockSync();
		return this._fs.rmdirSync(path);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		using _ = await this.lock();
		return await this._fs.mkdir(path, options);
	}

	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		using _ = this.lockSync();
		return this._fs.mkdirSync(path, options);
	}

	public async readdir(path: string): Promise<string[]> {
		using _ = await this.lock();
		return await this._fs.readdir(path);
	}

	public readdirSync(path: string): string[] {
		using _ = this.lockSync();
		return this._fs.readdirSync(path);
	}

	public async exists(path: string): Promise<boolean> {
		using _ = await this.lock();
		return await this._fs.exists(path);
	}

	public existsSync(path: string): boolean {
		using _ = this.lockSync();
		return this._fs.existsSync(path);
	}

	public async link(srcpath: string, dstpath: string): Promise<void> {
		using _ = await this.lock();
		await this._fs.link(srcpath, dstpath);
	}

	public linkSync(srcpath: string, dstpath: string): void {
		using _ = this.lockSync();
		return this._fs.linkSync(srcpath, dstpath);
	}

	public async sync(): Promise<void> {
		using _ = await this.lock();
		await this._fs.sync();
	}

	public syncSync(): void {
		using _ = this.lockSync();
		return this._fs.syncSync();
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		using _ = await this.lock();
		return await this._fs.read(path, buffer, offset, end);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		using _ = this.lockSync();
		return this._fs.readSync(path, buffer, offset, end);
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		using _ = await this.lock();
		return await this._fs.write(path, buffer, offset);
	}

	public writeSync(path: string, buffer: Uint8Array, offset: number): void {
		using _ = this.lockSync();
		return this._fs.writeSync(path, buffer, offset);
	}

	public streamRead(path: string, options: StreamOptions): ReadableStream {
		using _ = this.lockSync();
		return this._fs.streamRead(path, options);
	}

	public streamWrite(path: string, options: StreamOptions): WritableStream {
		using _ = this.lockSync();
		return this._fs.streamWrite(path, options);
	}

	/* eslint-enable @typescript-eslint/no-unused-vars */
}

/**
 * This serializes access to an underlying async filesystem.
 * For example, on an OverlayFS instance with an async lower
 * directory operations like rename and rmdir may involve multiple
 * requests involving both the upper and lower file systems -- they
 * are not executed in a single atomic step. OverlayFS used to use this
 * to avoid having to reason about the correctness of
 * multiple requests interleaving.
 *
 * @privateRemarks
 * Instead of extending the passed class, `MutexedFS` stores it internally.
 * This is to avoid a deadlock caused when a method calls another one
 * The problem is discussed extensively in [#78](https://github.com/zen-fs/core/issues/78)
 * Instead of extending `FileSystem`,
 * `MutexedFS` implements it in order to make sure all of the methods are passed through
 *
 * @todo Change `using _` to `using void` pending https://github.com/tc39/proposal-discard-binding
 * @category Internals
 * @internal
 */
export function Mutexed<const T extends Concrete<typeof FileSystem>>(
	FS: T
): typeof _MutexedFS<InstanceType<T>> & {
	new (...args: ConstructorParameters<T>): _MutexedFS<InstanceType<T>>;
} {
	class MutexedFS extends _MutexedFS<InstanceType<T>> {
		public constructor(...args: ConstructorParameters<T>) {
			super();
			this._fs = new FS(...args) as InstanceType<T>;
		}
	}
	return MutexedFS;
}
