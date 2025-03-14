/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Worker as NodeWorker, TransferListItem } from 'node:worker_threads';
import type { WithOptional } from 'utilium';
import type { MountConfiguration } from '../config.js';
import type { ErrnoErrorJSON } from '../internal/error.js';
import type { CreationOptions, UsageInfo } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import type { Backend, FilesystemOf } from './backend.js';

import { pick, serialize } from 'utilium';
import { resolveMountConfig } from '../config.js';
import { Errno, ErrnoError } from '../internal/error.js';
import { FileSystem } from '../internal/filesystem.js';
import { Inode } from '../internal/inode.js';
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

/**
 * The options for the Port backend
 * @category Backends and Configuration
 */
export interface PortOptions {
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
 * The API for remote procedure calls
 * @category Internals
 * @internal
 */
export interface RPCMethods {
	usage(): UsageInfo;
	ready(): void;
	rename(oldPath: string, newPath: string): void;
	createFile(path: string, options: CreationOptions): Uint8Array;
	unlink(path: string): void;
	rmdir(path: string): void;
	mkdir(path: string, options: CreationOptions): Uint8Array;
	readdir(path: string): string[];
	touch(path: string, metadata: Uint8Array): void;
	exists(path: string): boolean;
	link(target: string, link: string): void;
	sync(path: string): void;
	read(path: string, buffer: Uint8Array, start: number, end: number): Uint8Array;
	write(path: string, buffer: Uint8Array, offset: number): void;
	stat(path: string): Uint8Array;
}

/**
 * The methods that can be called on the RPC port
 * @category Internals
 * @internal
 */
export type RPCMethod = keyof RPCMethods;

/**
 * An RPC message
 * @category Internals
 * @internal
 */
export interface RPCMessage {
	_zenfs: true;
	id: string;
	method: RPCMethod;
	stack: string;
}

interface RPCRequest<TMethod extends RPCMethod = RPCMethod> extends RPCMessage {
	method: TMethod;
	args: Parameters<RPCMethods[TMethod]>;
}

interface RPCResponse<TMethod extends RPCMethod = RPCMethod> extends RPCMessage {
	error?: WithOptional<ErrnoErrorJSON, 'code' | 'errno'>;
	method: TMethod;

	// Note: This is undefined if an error occurs, and we check it at runtime
	// We don't do the type stuff because Typescript gets confused
	value: ReturnType<RPCMethods[TMethod]>;
}

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
	{ port, timeout = 1000, fs }: Partial<PortOptions> & { fs?: PortFS } = {}
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

// Why Typescript, WHY does the type need to be asserted even when the method is explicitly checked?

function __requestMethod<const T extends RPCMethod>(req: RPCRequest): asserts req is RPCRequest<T> {}

function __responseMethod<const R extends RPCResponse, const T extends RPCMethod>(res: R, ...t: T[]): res is R & RPCResponse<T> {
	return t.includes(res.method as T);
}

function handleResponse<const TMethod extends RPCMethod>(response: RPCResponse<TMethod>): void {
	if (!isRPCMessage(response)) return;

	if (!executors.has(response.id)) {
		const error = err(new ErrnoError(Errno.EIO, 'Invalid RPC id:' + response.id));
		error.stack += response.stack;
		throw error;
	}

	const { resolve, reject } = executors.get(response.id)!;
	if (response.error) {
		const e = ErrnoError.fromJSON({ code: 'EIO', errno: Errno.EIO, ...response.error });
		e.stack += response.stack;
		reject(e);
		executors.delete(response.id);
		return;
	}

	resolve(__responseMethod(response, 'stat', 'createFile', 'mkdir') ? new Inode(response.value) : response.value);

	executors.delete(response.id);
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
	public constructor(public readonly options: PortOptions) {
		super(0x706f7274, 'portfs');
		this.port = options.port;
		attach<RPCResponse>(this.port, handleResponse);
	}

	protected rpc<const T extends RPCMethod>(method: T, ...args: Parameters<RPCMethods[T]>): Promise<Awaited<ReturnType<RPCMethods[T]>>> {
		return request<RPCRequest<T>, Awaited<ReturnType<RPCMethods[T]>>>({ method, args } as Omit<RPCRequest<T>, 'id' | 'stack' | '_zenfs'>, {
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

	public async stat(path: string): Promise<Inode> {
		return new Inode(await this.rpc('stat', path));
	}

	public async touch(path: string, metadata: InodeLike | Inode): Promise<void> {
		await this.rpc('touch', path, serialize(metadata instanceof Inode ? metadata : new Inode(metadata)));
	}

	public sync(path: string): Promise<void> {
		return this.rpc('sync', path);
	}

	public async createFile(path: string, options: CreationOptions): Promise<Inode> {
		return new Inode(await this.rpc('createFile', path, options));
	}

	public unlink(path: string): Promise<void> {
		return this.rpc('unlink', path);
	}

	public rmdir(path: string): Promise<void> {
		return this.rpc('rmdir', path);
	}

	public async mkdir(path: string, options: CreationOptions): Promise<Inode> {
		return new Inode(await this.rpc('mkdir', path, options));
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

/** @internal */
export async function handleRequest(port: RPCPort, fs: FileSystem & { _descriptors?: Map<number, File> }, request: RPCRequest): Promise<void> {
	if (!isRPCMessage(request)) return;

	let value, error: ErrnoErrorJSON | Pick<Error, 'message' | 'stack'> | undefined;
	const transferList: TransferListItem[] = [];

	try {
		switch (request.method) {
			case 'read': {
				__requestMethod<'read'>(request);
				const [path, buffer, start, end] = request.args;
				await fs.read(path, buffer, start, end);
				value = buffer;
				break;
			}
			case 'stat':
			case 'createFile':
			case 'mkdir': {
				__requestMethod<'stat' | 'createFile' | 'mkdir'>(request);
				// @ts-expect-error 2556
				const inode = await fs[request.method](...request.args);
				value = serialize(inode instanceof Inode ? inode : new Inode(inode));
				break;
			}
			case 'touch': {
				__requestMethod<'touch'>(request);
				const [path, metadata] = request.args;
				await fs.touch(path, new Inode(metadata));
				value = undefined;
				break;
			}

			default:
				// @ts-expect-error 2556
				value = (await fs[request.method](...request.args)) as ReturnType<RPCMethods[TMethod]>;
		}
	} catch (e: any) {
		error = e instanceof ErrnoError ? e.toJSON() : pick(e, 'message', 'stack');
	}
	port.postMessage({ _zenfs: true, ...pick(request, 'id', 'method', 'stack'), error, value }, transferList);
}

export function attachFS(port: RPCPort, fs: FileSystem): void {
	attach<RPCRequest>(port, request => handleRequest(port, fs, request));
}

export function detachFS(port: RPCPort, fs: FileSystem): void {
	detach<RPCRequest>(port, request => handleRequest(port, fs, request));
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
	create(options: PortOptions) {
		return new PortFS(options);
	},
} satisfies Backend<PortFS, PortOptions>;
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
