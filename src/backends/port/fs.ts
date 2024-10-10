/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FileReadResult } from 'node:fs/promises';
import type { ExtractProperties } from 'utilium';
import { resolveMountConfig, type MountConfiguration } from '../../config.js';
import { Errno, ErrnoError } from '../../error.js';
import { File } from '../../file.js';
import { FileSystem, type FileSystemMetadata } from '../../filesystem.js';
import { Async } from '../../mixins/async.js';
import { Stats, type FileType } from '../../stats.js';
import type { Backend, FilesystemOf } from '../backend.js';
import { InMemory } from '../memory.js';
import * as RPC from './rpc.js';

type FileMethods = Omit<ExtractProperties<File, (...args: any[]) => Promise<any>>, typeof Symbol.asyncDispose>;
type FileMethod = keyof FileMethods;
interface FileRequest<TMethod extends FileMethod = FileMethod> extends RPC.Request {
	fd: number;
	scope: 'file';
	method: TMethod;
	args: Parameters<FileMethods[TMethod]>;
}

export class PortFile extends File {
	public constructor(
		public fs: PortFS,
		public readonly fd: number,
		path: string,
		public position: number
	) {
		super(fs, path);
	}

	public rpc<const T extends FileMethod>(method: T, ...args: Parameters<FileMethods[T]>): Promise<Awaited<ReturnType<FileMethods[T]>>> {
		return RPC.request<FileRequest<T>, Awaited<ReturnType<FileMethods[T]>>>(
			{
				scope: 'file',
				fd: this.fd,
				method,
				args,
			},
			this.fs.options
		);
	}

	protected _throwNoSync(syscall: string): never {
		throw new ErrnoError(Errno.ENOTSUP, 'Synchronous operations not supported on PortFile', this.path, syscall);
	}

	public async stat(): Promise<Stats> {
		return new Stats(await this.rpc('stat'));
	}

	public statSync(): Stats {
		this._throwNoSync('stat');
	}

	public truncate(len: number): Promise<void> {
		return this.rpc('truncate', len);
	}

	public truncateSync(): void {
		this._throwNoSync('truncate');
	}

	public write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number> {
		return this.rpc('write', buffer, offset, length, position);
	}

	public writeSync(): number {
		this._throwNoSync('write');
	}

	public async read<TBuffer extends NodeJS.ArrayBufferView>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<FileReadResult<TBuffer>> {
		const result = await this.rpc('read', buffer, offset, length, position);
		return result as FileReadResult<TBuffer>;
	}

	public readSync(): number {
		this._throwNoSync('read');
	}

	public chown(uid: number, gid: number): Promise<void> {
		return this.rpc('chown', uid, gid);
	}

	public chownSync(): void {
		this._throwNoSync('chown');
	}

	public chmod(mode: number): Promise<void> {
		return this.rpc('chmod', mode);
	}

	public chmodSync(): void {
		this._throwNoSync('chmod');
	}

	public utimes(atime: Date, mtime: Date): Promise<void> {
		return this.rpc('utimes', atime, mtime);
	}

	public utimesSync(): void {
		this._throwNoSync('utimes');
	}

	public _setType(type: FileType): Promise<void> {
		return this.rpc('_setType', type);
	}

	public _setTypeSync(): void {
		this._throwNoSync('_setType');
	}

	public close(): Promise<void> {
		return this.rpc('close');
	}

	public closeSync(): void {
		this._throwNoSync('close');
	}

	public sync(): Promise<void> {
		return this.rpc('sync');
	}

	public syncSync(): void {
		this._throwNoSync('sync');
	}
}

type FSMethods = ExtractProperties<FileSystem, (...args: any[]) => Promise<any> | FileSystemMetadata>;
type FSMethod = keyof FSMethods;
interface FSRequest<TMethod extends FSMethod = FSMethod> extends RPC.Request {
	scope: 'fs';
	method: TMethod;
	args: Parameters<FSMethods[TMethod]>;
}

/**
 * PortFS lets you access a ZenFS instance that is running in a port, or the other way around.
 *
 * Note that synchronous operations are not permitted on the PortFS, regardless
 * of the configuration option of the remote FS.
 */
export class PortFS extends Async(FileSystem) {
	public readonly port: RPC.Port;

	/**
	 * @hidden
	 */
	_sync = InMemory.create({ name: 'port-tmpfs' });

	/**
	 * Constructs a new PortFS instance that connects with ZenFS running on
	 * the specified port.
	 */
	public constructor(public readonly options: RPC.Options) {
		super();
		this.port = options.port;
		RPC.attach<RPC.Response>(this.port, RPC.handleResponse);
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: 'PortFS',
		};
	}

	protected rpc<const T extends FSMethod>(method: T, ...args: Parameters<FSMethods[T]>): Promise<Awaited<ReturnType<FSMethods[T]>>> {
		return RPC.request<FSRequest<T>, Awaited<ReturnType<FSMethods[T]>>>(
			{
				scope: 'fs',
				method,
				args,
			},
			{ ...this.options, fs: this }
		);
	}

	public async ready(): Promise<void> {
		await this.rpc('ready');
		await super.ready();
	}

	public rename(oldPath: string, newPath: string): Promise<void> {
		return this.rpc('rename', oldPath, newPath);
	}

	public async stat(path: string): Promise<Stats> {
		return new Stats(await this.rpc('stat', path));
	}

	public sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		return this.rpc('sync', path, data, stats);
	}

	public openFile(path: string, flag: string): Promise<File> {
		return this.rpc('openFile', path, flag);
	}

	public createFile(path: string, flag: string, mode: number): Promise<File> {
		return this.rpc('createFile', path, flag, mode);
	}

	public unlink(path: string): Promise<void> {
		return this.rpc('unlink', path);
	}

	public rmdir(path: string): Promise<void> {
		return this.rpc('rmdir', path);
	}

	public mkdir(path: string, mode: number): Promise<void> {
		return this.rpc('mkdir', path, mode);
	}

	public readdir(path: string): Promise<string[]> {
		return this.rpc('readdir', path);
	}

	public exists(path: string): Promise<boolean> {
		return this.rpc('exists', path);
	}

	public link(srcpath: string, dstpath: string): Promise<void> {
		return this.rpc('link', srcpath, dstpath);
	}
}

let nextFd = 0;

const descriptors: Map<number, File> = new Map();

/**
 * @internal
 */
export type FileOrFSRequest = FSRequest | FileRequest;

/**
 * @internal
 */
export async function handleRequest(port: RPC.Port, fs: FileSystem, request: FileOrFSRequest): Promise<void> {
	if (!RPC.isMessage(request)) {
		return;
	}
	const { method, args, id, scope, stack } = request;

	let value,
		error: boolean = false;

	try {
		switch (scope) {
			case 'fs':
				// @ts-expect-error 2556
				value = await fs[method](...args);
				if (value instanceof File) {
					descriptors.set(++nextFd, value);
					value = {
						fd: nextFd,
						path: value.path,
						position: value.position,
					};
				}
				break;
			case 'file':
				const { fd } = request;
				if (!descriptors.has(fd)) {
					throw new ErrnoError(Errno.EBADF);
				}
				// @ts-expect-error 2556
				value = await descriptors.get(fd)![method](...args);
				if (method == 'close') {
					descriptors.delete(fd);
				}
				break;
			default:
				return;
		}
	} catch (e: any) {
		value = e instanceof ErrnoError ? e.toJSON() : e.toString();
		error = true;
	}

	port.postMessage({ _zenfs: true, scope, id, error, method, stack, value });
}

export function attachFS(port: RPC.Port, fs: FileSystem): void {
	RPC.attach<FileOrFSRequest>(port, request => handleRequest(port, fs, request));
}

export function detachFS(port: RPC.Port, fs: FileSystem): void {
	RPC.detach<FileOrFSRequest>(port, request => handleRequest(port, fs, request));
}

const _Port = {
	name: 'Port',

	options: {
		port: {
			type: 'object',
			required: true,
			description: 'The target port that you want to connect to',
			validator(port: RPC.Port) {
				// Check for a `postMessage` function.
				if (typeof port?.postMessage != 'function') {
					throw new ErrnoError(Errno.EINVAL, 'option must be a port.');
				}
			},
		},
		timeout: {
			type: 'number',
			required: false,
			description: 'How long to wait before the request times out',
		},
	},

	isAvailable(): boolean {
		return true;
	},

	create(options: RPC.Options) {
		return new PortFS(options);
	},
} satisfies Backend<PortFS, RPC.Options>;
type _Port = typeof _Port;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Port extends _Port {}
export const Port: Port = _Port;

export async function resolveRemoteMount<T extends Backend>(port: RPC.Port, config: MountConfiguration<T>, _depth = 0): Promise<FilesystemOf<T>> {
	const stopAndReplay = RPC.catchMessages(port);
	const fs = await resolveMountConfig(config, _depth);
	attachFS(port, fs);
	stopAndReplay(fs);
	return fs;
}
