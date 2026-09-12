// SPDX-License-Identifier: LGPL-3.0-or-later
import { RwLockable } from 'kerium/locks';
import type { UUID } from 'node:crypto';
import type { Concrete } from 'utilium';
import type { CreationOptions, FileSystem, StreamOptions, UsageInfo } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import type { IoctlContext } from '../internal/ioctl.js';
import '../polyfills.js';

/**
 * @hidden
 * @category Internals
 * @deprecated This is no longer needed and will be removed
 * @todo [breaking] Remove
 */
export class _MutexedFS<T extends FileSystem> extends RwLockable implements FileSystem {
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

	public async rename(oldPath: string, newPath: string): Promise<void> {
		using _ = await this.lock('rw');
		await this._fs.rename(oldPath, newPath);
	}

	public renameSync(oldPath: string, newPath: string): void {
		using _ = this.lockSync('rw');
		return this._fs.renameSync(oldPath, newPath);
	}

	public async stat(path: string): Promise<InodeLike> {
		using _ = await this.lock('ro');
		return await this._fs.stat(path);
	}

	public statSync(path: string): InodeLike {
		using _ = this.lockSync('ro');
		return this._fs.statSync(path);
	}

	public async touch(path: string, metadata: InodeLike): Promise<void> {
		using _ = await this.lock('rw');
		await this._fs.touch(path, metadata);
	}

	public touchSync(path: string, metadata: InodeLike): void {
		using _ = this.lockSync('rw');
		this._fs.touchSync(path, metadata);
	}

	public async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		using _ = await this.lock('rw');
		return await this._fs.createFile(path, options);
	}

	public createFileSync(path: string, options: CreationOptions): InodeLike {
		using _ = this.lockSync('rw');
		return this._fs.createFileSync(path, options);
	}

	public async unlink(path: string): Promise<void> {
		using _ = await this.lock('rw');
		await this._fs.unlink(path);
	}

	public unlinkSync(path: string): void {
		using _ = this.lockSync('rw');
		return this._fs.unlinkSync(path);
	}

	public async rmdir(path: string): Promise<void> {
		using _ = await this.lock('rw');
		await this._fs.rmdir(path);
	}

	public rmdirSync(path: string): void {
		using _ = this.lockSync('rw');
		return this._fs.rmdirSync(path);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		using _ = await this.lock('rw');
		return await this._fs.mkdir(path, options);
	}

	public mkdirSync(path: string, options: CreationOptions): InodeLike {
		using _ = this.lockSync('rw');
		return this._fs.mkdirSync(path, options);
	}

	public async readdir(path: string): Promise<string[]> {
		using _ = await this.lock('ro');
		return await this._fs.readdir(path);
	}

	public readdirSync(path: string): string[] {
		using _ = this.lockSync('ro');
		return this._fs.readdirSync(path);
	}

	public async exists(path: string): Promise<boolean> {
		using _ = await this.lock('ro');
		return await this._fs.exists(path);
	}

	public existsSync(path: string): boolean {
		using _ = this.lockSync('ro');
		return this._fs.existsSync(path);
	}

	public async link(srcpath: string, dstpath: string): Promise<void> {
		using _ = await this.lock('rw');
		await this._fs.link(srcpath, dstpath);
	}

	public linkSync(srcpath: string, dstpath: string): void {
		using _ = this.lockSync('rw');
		return this._fs.linkSync(srcpath, dstpath);
	}

	public async sync(): Promise<void> {
		using _ = await this.lock('rw');
		await this._fs.sync();
	}

	public syncSync(): void {
		using _ = this.lockSync('rw');
		return this._fs.syncSync();
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		using _ = await this.lock('ro');
		return await this._fs.read(path, buffer, offset, end);
	}

	public readSync(path: string, buffer: Uint8Array, offset: number, end: number): void {
		using _ = this.lockSync('ro');
		return this._fs.readSync(path, buffer, offset, end);
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		using _ = await this.lock('rw');
		return await this._fs.write(path, buffer, offset);
	}

	public writeSync(path: string, buffer: Uint8Array, offset: number): void {
		using _ = this.lockSync('rw');
		return this._fs.writeSync(path, buffer, offset);
	}

	public streamRead(path: string, options: StreamOptions): ReadableStream {
		using _ = this.lockSync('ro');
		return this._fs.streamRead(path, options);
	}

	public streamWrite(path: string, options: StreamOptions): WritableStream {
		using _ = this.lockSync('rw');
		return this._fs.streamWrite(path, options);
	}

	public async ioctl(context: IoctlContext, command: number, ...args: any[]): Promise<any> {
		using _ = await this.lock('rw');
		return await this._fs.ioctl({ ...context, fs: this._fs }, command, ...args);
	}

	public ioctlSync(context: IoctlContext, command: number, ...args: any[]) {
		using _ = this.lockSync('rw');
		return this._fs.ioctlSync({ ...context, fs: this._fs }, command, ...args);
	}
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
 * @category Internals
 * @internal
 * @deprecated This is no longer needed and will be removed
 * @todo [breaking] Remove
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
