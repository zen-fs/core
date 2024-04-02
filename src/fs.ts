import { Cred } from '@zenfs/core/cred.js';
import { File } from '@zenfs/core/file.js';
import { Async, FileSystem, type FileSystemMetadata } from '@zenfs/core/filesystem.js';
import { Stats, type FileType } from '@zenfs/core/stats.js';
import * as RPC from './rpc.js';
import { ApiError, ErrorCode } from '@zenfs/core';

export interface PortFSOptions {
	/**
	 * The target port that you want to connect to, or the current port if in a port context.
	 */
	port: RPC.Port;

	/**
	 * How long to wait for a message to resolve
	 */
	timeout?: number;
}

export class PortFile extends File {
	constructor(
		public readonly fs: PortFS,
		public readonly fd: number,
		public readonly path: string,
		public position?: number
	) {
		super();
	}

	stat(): Promise<Stats> {
		return this.fs.fileRPC(this.fd, 'stat');
	}
	statSync(): Stats {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	truncate(len: number): Promise<void> {
		return this.fs.fileRPC(this.fd, 'truncate', len);
	}
	truncateSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number> {
		return this.fs.fileRPC(this.fd, 'write', buffer, offset, length, position);
	}
	writeSync(): number {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	read<TBuffer extends Uint8Array>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: TBuffer }> {
		return <Promise<{ bytesRead: number; buffer: TBuffer }>>this.fs.fileRPC(this.fd, 'read', buffer, offset, length, position);
	}
	readSync(): number {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	chown(uid: number, gid: number): Promise<void> {
		return this.fs.fileRPC(this.fd, 'chown', uid, gid);
	}
	chownSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	chmod(mode: number): Promise<void> {
		return this.fs.fileRPC(this.fd, 'chmod', mode);
	}
	chmodSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	utimes(atime: Date, mtime: Date): Promise<void> {
		return this.fs.fileRPC(this.fd, 'utimes', atime, mtime);
	}
	utimesSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	_setType(type: FileType): Promise<void> {
		return this.fs.fileRPC(this.fd, '_setType', type);
	}
	_setTypeSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	close(): Promise<void> {
		return this.fs.fileRPC(this.fd, 'close');
	}
	closeSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
	sync(): Promise<void> {
		return this.fs.fileRPC(this.fd, 'sync');
	}
	syncSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
}

/**
 * PortFS lets you access a ZenFS instance that is running in a port, or the other way around.
 *
 * Note that synchronous operations are not permitted on the PortFS, regardless
 * of the configuration option of the remote FS.
 */
export class PortFS extends Async(FileSystem) {
	protected _port: RPC.Port;
	protected _currentID: number = 0;
	protected _requests: Map<number, RPC.RequestPromise> = new Map();
	protected _timeout: number = 1000;

	protected handleMessage(message: MessageEvent<RPC.Response> | RPC.Response): void {
		const data: RPC.Response = 'data' in message ? message.data : message;
		if (!RPC.isMessage(data)) {
			return;
		}
		const { id, value, method, error, stack } = data;
		const { resolve, reject } = this._requests.get(id);
		if (error) {
			const e = <ApiError>(<unknown>value);
			e.stack += stack;
			reject(e);
			this._requests.delete(id);
			return;
		}
		if (method == 'openFile' || method == 'createFile') {
			const file = new PortFile(this, (<RPC.File>(<unknown>value)).fd, value.path, value.position);
			resolve(file);
			this._requests.delete(id);
			return;
		}

		resolve(value);
		this._requests.delete(id);
		return;
	}

	/**
	 * Constructs a new PortFS instance that connects with ZenFS running on
	 * the specified port.
	 */
	public constructor({ port, timeout = 1000 }: PortFSOptions) {
		super();
		this._port = port;
		this._timeout = timeout;
		port['on' in port ? 'on' : 'addEventListener']('message', (msg: RPC.Response) => {
			this.handleMessage(msg);
		});
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: 'PortFS',
			synchronous: false,
		};
	}

	public async fileRPC<const T extends RPC.FileMethod>(fd: number, method: T, ...args: RPC.FileArgs<T>): RPC.FileValue<T> {
		return new Promise((resolve, reject) => {
			const id = this._currentID++;
			this._requests.set(id, { resolve, reject });
			this._port.postMessage({
				_zenfs: true,
				scope: 'file',
				id,
				fd,
				method,
				stack: new Error().stack.slice('Error:'.length),
				args,
			});
		});
	}

	protected async _rpc<const T extends RPC.FSMethod>(method: T, ...args: RPC.FSArgs<T>): RPC.FSValue<T> {
		return new Promise((resolve, reject) => {
			const id = this._currentID++;
			this._requests.set(id, { resolve, reject });
			this._port.postMessage({
				_zenfs: true,
				scope: 'fs',
				id,
				method,
				stack: new Error().stack.slice('Error:'.length),
				args,
			});
			setTimeout(() => {
				reject(new ApiError(ErrorCode.EIO, 'RPC Failed'));
			}, this._timeout);
		});
	}

	public async ready(): Promise<this> {
		await this._rpc('ready');
		return this;
	}

	public rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		return this._rpc('rename', oldPath, newPath, cred);
	}
	public async stat(p: string, cred: Cred): Promise<Stats> {
		return new Stats(await this._rpc('stat', p, cred));
	}
	public sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		return this._rpc('sync', path, data, stats);
	}
	public openFile(p: string, flag: string, cred: Cred): Promise<File> {
		return this._rpc('openFile', p, flag, cred);
	}
	public createFile(p: string, flag: string, mode: number, cred: Cred): Promise<File> {
		return this._rpc('createFile', p, flag, mode, cred);
	}
	public unlink(p: string, cred: Cred): Promise<void> {
		return this._rpc('unlink', p, cred);
	}
	public rmdir(p: string, cred: Cred): Promise<void> {
		return this._rpc('rmdir', p, cred);
	}
	public mkdir(p: string, mode: number, cred: Cred): Promise<void> {
		return this._rpc('mkdir', p, mode, cred);
	}
	public readdir(p: string, cred: Cred): Promise<string[]> {
		return this._rpc('readdir', p, cred);
	}
	public exists(p: string, cred: Cred): Promise<boolean> {
		return this._rpc('exists', p, cred);
	}
	public link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		return this._rpc('link', srcpath, dstpath, cred);
	}
}
