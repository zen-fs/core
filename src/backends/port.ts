// SPDX-License-Identifier: LGPL-3.0-or-later
import type { MountConfiguration } from '../config.js';
import type { CreationOptions } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import type { Backend, FilesystemOf } from './backend.js';

import { info } from 'kerium/log';
import { resolveMountConfig } from '../config.js';
import { FileSystem } from '../internal/filesystem.js';
import { Inode } from '../internal/inode.js';
import * as RPC from '../internal/rpc.js';
import { Async } from '../mixins/async.js';
import '../polyfills.js';
import { InMemory } from './memory.js';
export { RPC };

/**
 * @category Backends and Configuration
 */
export interface PortOptions {
	/**
	 * The target port that you want to connect to, or the current port if in a port context.
	 */
	port: RPC.Channel;
	/**
	 * How long to wait for a request to complete
	 */
	timeout?: number;
}

/**
 * PortFS lets you access an FS instance that is running in a port, or the other way around.
 *
 * Note that *direct* synchronous operations are not permitted on the PortFS,
 * regardless of the configuration option of the remote FS.
 * @category Internals
 * @internal
 */
export class PortFS<T extends RPC.Channel = RPC.Channel> extends Async(FileSystem) {
	public readonly port: RPC.Port<T>;

	/**
	 * @hidden
	 */
	_sync = InMemory.create({ label: 'tmpfs:port' });

	/**
	 * Constructs a new PortFS instance that connects with the FS running on `options.port`.
	 */
	public constructor(
		public readonly channel: T,
		public readonly timeout: number = 250
	) {
		super(0x706f7274, 'portfs');
		this.port = RPC.from(channel);
		RPC.attach<RPC.Response>(this.port, RPC.handleResponse);
	}

	protected rpc<const T extends RPC.Method>(method: T, ...args: Parameters<RPC.Methods[T]>): Promise<Awaited<ReturnType<RPC.Methods[T]>>> {
		return RPC.request<RPC.Request<T>, Awaited<ReturnType<RPC.Methods[T]>>>({ method, args } as Omit<RPC.Request<T>, 'id' | 'stack' | '_zenfs'>, {
			port: this.port,
			timeout: this.timeout,
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

	public async stat(path: string): Promise<Inode> {
		const result = await this.rpc('stat', path);
		return result instanceof Inode ? result : new Inode(result);
	}

	public async touch(path: string, metadata: InodeLike | Inode): Promise<void> {
		const inode = metadata instanceof Inode ? metadata : new Inode(metadata);
		await this.rpc('touch', path, new Uint8Array(inode.buffer, inode.byteOffset, inode.byteLength));
	}

	public async sync(): Promise<void> {
		await super.sync();
		await this.rpc('sync');
	}

	public async createFile(path: string, options: CreationOptions): Promise<Inode> {
		if (options instanceof Inode) options = options.toJSON();
		const result = await this.rpc('createFile', path, options);
		return result instanceof Inode ? result : new Inode(result);
	}

	public unlink(path: string): Promise<void> {
		return this.rpc('unlink', path);
	}

	public rmdir(path: string): Promise<void> {
		return this.rpc('rmdir', path);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<Inode> {
		if (options instanceof Inode) options = options.toJSON();
		const result = await this.rpc('mkdir', path, options);
		return result instanceof Inode ? result : new Inode(result);
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

	public async read(path: string, buffer: Uint8Array, start: number, end: number): Promise<void> {
		buffer.set(await this.rpc('read', path, buffer, start, end));
	}

	public write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		return this.rpc('write', path, buffer, offset);
	}
}

export function attachFS(channel: RPC.Channel | RPC.Port, fs: FileSystem): void {
	const port = RPC.from(channel);
	RPC.attach<RPC.Request>(port, request => RPC.handleRequest(port, fs, request));
}

export function detachFS(channel: RPC.Channel | RPC.Port, fs: FileSystem): void {
	const port = RPC.from(channel);
	RPC.detach<RPC.Request>(port, request => RPC.handleRequest(port, fs, request));
}

const _Port = {
	name: 'Port',
	options: {
		port: {
			type: [
				EventTarget,
				function EventEmitter(e) {
					return typeof e == 'object' && 'on' in e;
				},
			],
			required: true,
		},
		timeout: { type: 'number', required: false },
	},
	create(opt: PortOptions) {
		return new PortFS(opt.port, opt.timeout);
	},
} satisfies Backend<PortFS, PortOptions>;
type _Port = typeof _Port;

/**
 * @category Backends and Configuration
 */
export interface Port extends _Port {}

/**
 * A backend for usage with ports and workers. See the examples below.
 *
 * #### Accessing an FS on a remote Worker from the main thread
 *
 * Main:
 *
 * ```ts
 * import { configure } from '@zenfs/core';
 * import { Port } from '@zenfs/port';
 * import { Worker } from 'node:worker_threads';
 *
 * const worker = new Worker('worker.js');
 *
 * await configure({
 * 	mounts: {
 * 		'/worker': {
 * 			backend: Port,
 * 			port: worker,
 * 		},
 * 	},
 * });
 * ```
 *
 * Worker:
 *
 * ```ts
 * import { InMemory, resolveRemoteMount, attachFS } from '@zenfs/core';
 * import { parentPort } from 'node:worker_threads';
 *
 * await resolveRemoteMount(parentPort, { backend: InMemory, name: 'tmp' });
 * ```
 *
 * If you are using using web workers, you would use `self` instead of importing `parentPort` in the worker, and would not need to import `Worker` in the main thread.
 *
 * #### Using with multiple ports on the same thread
 *
 * ```ts
 * import { InMemory, fs, resolveMountConfig, resolveRemoteMount, Port } from '@zenfs/core';
 * import { MessageChannel } from 'node:worker_threads';
 *
 * const { port1: localPort, port2: remotePort } = new MessageChannel();
 *
 * fs.mount('/remote', await resolveRemoteMount(remotePort, { backend: InMemory, name: 'tmp' }));
 * fs.mount('/port', await resolveMountConfig({ backend: Port, port: localPort }));
 *
 * const content = 'FS is in a port';
 *
 * await fs.promises.writeFile('/port/test', content);
 *
 * fs.readFileSync('/remote/test', 'utf8'); // FS is in a port
 * await fs.promises.readFile('/port/test', 'utf8'); // FS is in a port
 * ```
 *
 * @category Backends and Configuration
 */
export const Port: Port = _Port;

/**
 * @category Backends and Configuration
 */
export async function resolveRemoteMount<T extends Backend>(
	channel: RPC.Channel | RPC.Port,
	config: MountConfiguration<T>,
	_depth = 0
): Promise<FilesystemOf<T>> {
	const port = RPC.from(channel);
	const stopAndReplay = RPC.catchMessages(port);
	const fs = await resolveMountConfig(config, _depth);
	attachFS(port, fs);
	await stopAndReplay(fs);
	info('Resolved remote mount: ' + fs.toString());
	return fs;
}
