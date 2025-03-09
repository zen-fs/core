/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Worker as NodeWorker, TransferListItem } from 'node:worker_threads';
import type { ExtractProperties, WithOptional } from 'utilium';
import type { MountConfiguration } from '../config.js';
import type { ErrnoErrorJSON } from '../internal/error.js';
import type { CreationOptions, UsageInfo } from '../internal/filesystem.js';
import type { Inode, InodeLike } from '../internal/inode.js';
import type { Backend, FilesystemOf } from './backend.js';

import { pick } from 'utilium';
import { resolveMountConfig } from '../config.js';
import { Errno, ErrnoError } from '../internal/error.js';
import { FileSystem } from '../internal/filesystem.js';
import { err, info } from '../internal/log.js';
import { Async } from '../mixins/async.js';
import '../polyfills.js';
import { _fnOpt } from './backend.js';
import { InMemory } from './memory.js';

type _MessageEvent<T = any> = T | { data: T };

/** @internal */
export interface RPCPort {
	postMessage(value: unknown, transfer?: TransferListItem[]): void;
	on?(event: 'message' | 'online', listener: (value: unknown) => void): this;
	off?(event: 'message', listener: (value: unknown) => void): this;
	addEventListener?(type: 'message', listener: (ev: _MessageEvent) => void): void;
	removeEventListener?(type: 'message', listener: (ev: _MessageEvent) => void): void;
}

interface RPCOptions {
	/**
	 * The target port that you want to connect to, or the current port if in a port context.
	 */
	port: RPCPort;
	/**
	 * How long to wait for a request to complete
	 */
	timeout?: number;
}

/**
 * An RPC message
 * @internal @hidden
 */
export interface RPCMessage {
	_zenfs: true;
	id: string;
	method: string;
	stack: string;
}

interface RPCRequest extends RPCMessage {
	args: unknown[];
}

interface _ResponseWithError extends RPCMessage {
	error: true;
	value: WithOptional<ErrnoErrorJSON, 'code' | 'errno'>;
}

interface _ResponseWithValue<T> extends RPCMessage {
	error: false;
	value: Awaited<T>;
}

interface _ResponseRead extends RPCMessage {
	error: false;
	method: 'read';
	value: Uint8Array;
}

type RPCResponse<T = unknown> = _ResponseWithError | _ResponseWithValue<T> | _ResponseRead;

// general types

function isRPCMessage(arg: unknown): arg is RPCMessage {
	return typeof arg == 'object' && arg != null && '_zenfs' in arg && !!arg._zenfs;
}

/**
 * An RPC executor
 * @internal @hidden
 */
interface RPCExecutor extends PromiseWithResolvers<any> {
	fs?: PortFS;
}
const executors: Map<string, RPCExecutor> = new Map();

function request<const TRequest extends RPCRequest, TValue>(
	request: Omit<TRequest, 'id' | 'stack' | '_zenfs'>,
	{ port, timeout = 1000, fs }: Partial<RPCOptions> & { fs?: PortFS } = {}
): Promise<TValue> {
	const stack = '\n' + new Error().stack!.slice('Error:'.length);
	if (!port) throw err(new ErrnoError(Errno.EINVAL, 'Can not make an RPC request without a port'));

	const { resolve, reject, promise } = Promise.withResolvers<TValue>();

	const id = Math.random().toString(16).slice(10);
	executors.set(id, { resolve, reject, promise, fs });
	port.postMessage({ ...request, _zenfs: true, id, stack });
	const _ = setTimeout(() => {
		const error = err(new ErrnoError(Errno.EIO, 'RPC Failed', typeof request.args[0] == 'string' ? request.args[0] : '', request.method), {
			fs,
		});
		error.stack += stack;
		reject(error);
		if (typeof _ == 'object') _.unref();
	}, timeout);

	return promise;
}

function handleResponse<const TResponse extends RPCResponse>(response: TResponse): void {
	if (!isRPCMessage(response)) {
		return;
	}
	const { id, value, error, stack } = response;
	if (!executors.has(id)) {
		const error = err(new ErrnoError(Errno.EIO, 'Invalid RPC id:' + id));
		error.stack += stack;
		throw error;
	}
	const { resolve, reject } = executors.get(id)!;
	if (error) {
		const e = ErrnoError.fromJSON({ code: 'EIO', errno: Errno.EIO, ...value });
		e.stack += stack;
		reject(e);
		executors.delete(id);
		return;
	}

	resolve(value);
	executors.delete(id);
	return;
}

export function attach<T extends RPCMessage>(port: RPCPort, handler: (message: T) => unknown) {
	if (!port) throw err(new ErrnoError(Errno.EINVAL, 'Cannot attach to non-existent port'));
	info('Attached handler to port: ' + handler.name);

	port['on' in port ? 'on' : 'addEventListener']!('message', (message: T | _MessageEvent<T>) => {
		handler(typeof message == 'object' && message !== null && 'data' in message ? message.data : message);
	});
}

export function detach<T extends RPCMessage>(port: RPCPort, handler: (message: T) => unknown) {
	if (!port) throw err(new ErrnoError(Errno.EINVAL, 'Cannot detach from non-existent port'));
	info('Detached handler from port: ' + handler.name);

	port['off' in port ? 'off' : 'removeEventListener']!('message', (message: T | _MessageEvent<T>) => {
		handler(typeof message == 'object' && message !== null && 'data' in message ? message.data : message);
	});
}

export function catchMessages<T extends Backend>(port: RPCPort): (fs: FilesystemOf<T>) => Promise<void> {
	const events: _MessageEvent[] = [];
	const handler = events.push.bind(events);
	attach(port, handler);
	return async function (fs: FileSystem) {
		detach(port, handler);
		for (const event of events) {
			const request = 'data' in event ? event.data : event;
			await handleRequest(port, fs, request);
		}
	};
}

/**
 * @internal
 */
export async function waitOnline(port: RPCPort): Promise<void> {
	if (!('on' in port)) return; // Only need to wait in Node.js
	const online = Promise.withResolvers<void>();
	setTimeout(online.reject, 500);
	(port as NodeWorker).on('online', online.resolve);
	await online.promise;
}

type FSMethods = ExtractProperties<FileSystem, (...args: any[]) => Promise<any> | UsageInfo>;
type FSMethod = keyof FSMethods;

export type FSRequest<TMethod extends FSMethod = FSMethod> = RPCRequest
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
 * @category Internals
 * @internal
 */
export class PortFS extends Async(FileSystem) {
	public readonly port: RPCPort;

	/**`
	 * @hidden
	 */
	_sync = InMemory.create({ label: 'tmpfs:port' });

	/**
	 * Constructs a new PortFS instance that connects with the FS running on `options.port`.
	 */
	public constructor(public readonly options: RPCOptions) {
		super(0x706f7274, 'portfs');
		this.port = options.port;
		attach<RPCResponse>(this.port, handleResponse);
	}

	protected rpc<const T extends FSMethod>(method: T, ...args: Parameters<FSMethods[T]>): Promise<Awaited<ReturnType<FSMethods[T]>>> {
		return request<FSRequest<T>, Awaited<ReturnType<FSMethods[T]>>>({ method, args } as Omit<FSRequest<T>, 'id' | 'stack' | '_zenfs'>, {
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

	public async touch(path: string, metadata: InodeLike | Inode): Promise<void> {
		metadata = 'toJSON' in metadata ? metadata.toJSON() : metadata;
		await this.rpc('touch', path, metadata);
	}

	public sync(path: string, data: Uint8Array | undefined, stats: Readonly<InodeLike | Inode>): Promise<void> {
		stats = 'toJSON' in stats ? stats.toJSON() : stats;
		return this.rpc('sync', path, data, stats);
	}

	public createFile(path: string, options: CreationOptions): Promise<InodeLike> {
		return this.rpc('createFile', path, options);
	}

	public unlink(path: string): Promise<void> {
		return this.rpc('unlink', path);
	}

	public rmdir(path: string): Promise<void> {
		return this.rpc('rmdir', path);
	}

	public mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
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
export async function handleRequest(port: RPCPort, fs: FileSystem & { _descriptors?: Map<number, File> }, request: FSRequest): Promise<void> {
	if (!isRPCMessage(request)) return;

	const { method, args, id, stack } = request;

	let value,
		error: boolean = false;

	try {
		// @ts-expect-error 2556
		value = await fs[method](...args);
		switch (method) {
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

export function attachFS(port: RPCPort, fs: FileSystem): void {
	attach<FSRequest>(port, request => handleRequest(port, fs, request));
}

export function detachFS(port: RPCPort, fs: FileSystem): void {
	detach<FSRequest>(port, request => handleRequest(port, fs, request));
}

const _Port = {
	name: 'Port',
	options: {
		port: {
			type: _fnOpt('RPCPort', (port: RPCPort) => typeof port?.postMessage == 'function'),
			required: true,
		},
		timeout: { type: 'number', required: false },
	},
	create(options: RPCOptions) {
		return new PortFS(options);
	},
} satisfies Backend<PortFS, RPCOptions>;
type _Port = typeof _Port;

/**
 * @category Backends and Configuration
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
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
export async function resolveRemoteMount<T extends Backend>(port: RPCPort, config: MountConfiguration<T>, _depth = 0): Promise<FilesystemOf<T>> {
	const stopAndReplay = catchMessages(port);
	const fs = await resolveMountConfig(config, _depth);
	attachFS(port, fs);
	await stopAndReplay(fs);
	info('Resolved remote mount: ' + fs.toString());
	return fs;
}
