/* eslint-disable @typescript-eslint/no-explicit-any */
import { pick, type ExtractProperties } from 'utilium';
import type { MountConfiguration } from '../../config.js';
import type { CreationOptions, FileSystemMetadata } from '../../filesystem.js';
import type { Backend, FilesystemOf } from '../backend.js';

import type { TransferListItem } from 'node:worker_threads';
import { resolveMountConfig } from '../../config.js';
import { Errno, ErrnoError } from '../../error.js';
import { File } from '../../file.js';
import { FileSystem } from '../../filesystem.js';
import { Async } from '../../mixins/async.js';
import { Stats } from '../../stats.js';
import { InMemory } from '../memory.js';
import type { Inode, InodeLike } from '../store/inode.js';
import * as RPC from './rpc.js';

type FSMethods = ExtractProperties<FileSystem, (...args: any[]) => Promise<any> | FileSystemMetadata>;
type FSMethod = keyof FSMethods;
/** @internal */
export interface FSRequest<TMethod extends FSMethod = FSMethod> extends RPC.Request {
	method: TMethod;
	args: Parameters<FSMethods[TMethod]>;
}

/**
 * PortFS lets you access an FS instance that is running in a port, or the other way around.
 *
 * Note that *direct* synchronous operations are not permitted on the PortFS,
 * regardless of the configuration option of the remote FS.
 */
export class PortFS extends Async(FileSystem) {
	public readonly port: RPC.Port;

	/**`
	 * @hidden
	 */
	_sync = InMemory.create({ name: 'port-tmpfs' });

	/**
	 * Constructs a new PortFS instance that connects with the FS running on `options.port`.
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
		return RPC.request<FSRequest<T>, Awaited<ReturnType<FSMethods[T]>>>({ method, args }, { ...this.options, fs: this });
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

	public sync(path: string, data: Uint8Array | undefined, stats: Readonly<InodeLike | Inode>): Promise<void> {
		stats = 'toJSON' in stats ? stats.toJSON() : stats;
		return this.rpc('sync', path, data, stats);
	}

	public openFile(path: string, flag: string): Promise<File> {
		return this.rpc('openFile', path, flag);
	}

	public createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File> {
		return this.rpc('createFile', path, flag, mode, options);
	}

	public unlink(path: string): Promise<void> {
		return this.rpc('unlink', path);
	}

	public rmdir(path: string): Promise<void> {
		return this.rpc('rmdir', path);
	}

	public mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
		return this.rpc('mkdir', path, mode, options);
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

	public read(path: string, offset: number, length: number): Promise<Uint8Array> {
		return this.rpc('read', path, offset, length);
	}

	public write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		return this.rpc('write', path, buffer, offset);
	}
}

/** @internal */
export async function handleRequest(port: RPC.Port, fs: FileSystem & { _descriptors?: Map<number, File> }, request: FSRequest): Promise<void> {
	if (!RPC.isMessage(request)) return;

	const { method, args, id, stack } = request;

	let value,
		error: boolean = false;

	const transfer: TransferListItem[] = [];

	try {
		// @ts-expect-error 2556
		value = await fs[method](...args);
		if (value instanceof File) {
			await using file = await fs.openFile(args[0] as string, 'r+');
			const stats = await file.stat();
			const data = new Uint8Array(stats.size);

			await file.read(data);
			value = {
				path: value.path,
				flag: args[1] as string,
				stats,
				buffer: data.buffer,
			} satisfies RPC.FileData;
			transfer.push(data.buffer);
		}
	} catch (e: any) {
		value = e instanceof ErrnoError ? e.toJSON() : pick(e, 'message', 'stack');
		error = true;
	}

	port.postMessage({ _zenfs: true, id, error, method, stack, value }, transfer);
}

export function attachFS(port: RPC.Port, fs: FileSystem): void {
	RPC.attach<FSRequest>(port, request => handleRequest(port, fs, request));
}

export function detachFS(port: RPC.Port, fs: FileSystem): void {
	RPC.detach<FSRequest>(port, request => handleRequest(port, fs, request));
}

const _Port = {
	name: 'Port',

	options: {
		port: {
			type: 'object',
			required: true,
			validator(port: RPC.Port) {
				// Check for a `postMessage` function.
				if (typeof port?.postMessage != 'function') {
					throw new ErrnoError(Errno.EINVAL, 'option must be a port.');
				}
			},
		},
		timeout: { type: 'number', required: false },
	},
	create(options: RPC.Options) {
		return new PortFS(options);
	},
} satisfies Backend<PortFS, RPC.Options>;
type _Port = typeof _Port;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Port extends _Port {}
export const Port: Port = _Port;

export async function resolveRemoteMount<T extends Backend>(port: RPC.Port, config: MountConfiguration<T>, _depth = 0): Promise<FilesystemOf<T>> {
	const stopAndReplay = RPC.catchMessages(port);
	const fs = await resolveMountConfig(config, _depth);
	attachFS(port, fs);
	stopAndReplay(fs);
	return fs;
}
