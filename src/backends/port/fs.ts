/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExtractProperties } from 'utilium';
import type { Inode, InodeLike } from '../..//internal/inode.js';
import type { MountConfiguration } from '../../config.js';
import type { File } from '../../internal/file.js';
import type { CreationOptions, UsageInfo } from '../../internal/filesystem.js';
import type { Backend, FilesystemOf } from '../backend.js';

import { pick } from 'utilium';
import { resolveMountConfig } from '../../config.js';
import { ErrnoError } from '../../internal/error.js';
import { FileSystem } from '../../internal/filesystem.js';
import { info } from '../../internal/log.js';
import { Async } from '../../mixins/async.js';
import { InMemory } from '../memory.js';
import * as RPC from './rpc.js';

type FSMethods = ExtractProperties<FileSystem, (...args: any[]) => Promise<any> | UsageInfo>;
type FSMethod = keyof FSMethods;

export type FSRequest<TMethod extends FSMethod = FSMethod> = RPC.Message
	& {
		[M in TMethod]: {
			method: M;
			args: Parameters<FSMethods[M]>;
		};
	}[TMethod];

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
	_sync = InMemory.create({ label: 'tmpfs:port' });

	/**
	 * Constructs a new PortFS instance that connects with the FS running on `options.port`.
	 */
	public constructor(public readonly options: RPC.Options) {
		super(0x706f7274, 'portfs');
		this.port = options.port;
		RPC.attach<RPC.Response>(this.port, RPC.handleResponse);
	}

	protected rpc<const T extends FSMethod>(method: T, ...args: Parameters<FSMethods[T]>): Promise<Awaited<ReturnType<FSMethods[T]>>> {
		return RPC.request<FSRequest<T>, Awaited<ReturnType<FSMethods[T]>>>({ method, args } as Omit<FSRequest<T>, 'id' | 'stack' | '_zenfs'>, {
			...this.options,
			fs: this,
		});
	}

	public async ready(): Promise<void> {
		await this.rpc('ready');
		await super.ready();
	}

	public rename(oldPath: string, newPath: string): Promise<void> {
		return this.rpc('rename', oldPath, newPath);
	}

	public async stat(path: string): Promise<InodeLike> {
		return await this.rpc('stat', path);
	}

	public async touch(path: string, metadata: InodeLike): Promise<void> {
		await this.rpc('touch', path, metadata);
	}

	public sync(path: string, data: Uint8Array | undefined, stats: Readonly<InodeLike | Inode>): Promise<void> {
		stats = 'toJSON' in stats ? stats.toJSON() : stats;
		return this.rpc('sync', path, data, stats);
	}

	public openFile(path: string, flag: string): Promise<File> {
		return this.rpc('openFile', path, flag);
	}

	public createFile(path: string, flag: string, options: CreationOptions): Promise<File> {
		return this.rpc('createFile', path, flag, options);
	}

	public unlink(path: string): Promise<void> {
		return this.rpc('unlink', path);
	}

	public rmdir(path: string): Promise<void> {
		return this.rpc('rmdir', path);
	}

	public mkdir(path: string, options: CreationOptions): Promise<void> {
		return this.rpc('mkdir', path, options);
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

	public async read(path: string, buffer: Uint8Array, offset: number, length: number): Promise<void> {
		const _buf = (await this.rpc('read', path, buffer, offset, length)) as unknown as Uint8Array;
		buffer.set(_buf);
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

	try {
		// @ts-expect-error 2556
		value = await fs[method](...args);
		switch (method) {
			case 'openFile':
			case 'createFile': {
				value = {
					path: args[0],
					flag: args[1],
					stats: await fs.stat(args[0]),
				} satisfies RPC.FileData;
				break;
			}
			case 'read':
				value = args[1];
				break;
		}
	} catch (e: any) {
		value = e instanceof ErrnoError ? e.toJSON() : pick(e, 'message', 'stack');
		error = true;
	}

	port.postMessage({ _zenfs: true, id, error, method, stack, value });
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
			type: (port: RPC.Port) => typeof port?.postMessage != 'function',
			required: true,
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

/**
 * @category Backends and Configuration
 */
export const Port: Port = _Port;

/**
 * @category Backends and Configuration
 */
export async function resolveRemoteMount<T extends Backend>(port: RPC.Port, config: MountConfiguration<T>, _depth = 0): Promise<FilesystemOf<T>> {
	const stopAndReplay = RPC.catchMessages(port);
	const fs = await resolveMountConfig(config, _depth);
	attachFS(port, fs);
	await stopAndReplay(fs);
	info('Resolved remote mount: ' + fs.toString());
	return fs;
}
