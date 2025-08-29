/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExceptionJSON } from 'kerium';
import type { TransferListItem } from 'node:worker_threads';
import type { WithOptional } from 'utilium';
import type { Backend, FilesystemOf } from '../backends/backend.js';
import type { PortFS } from '../backends/port.js';
import type { CreationOptions, FileSystem, UsageInfo } from '../internal/filesystem.js';

import { Errno, Exception, withErrno } from 'kerium';
import { err, info, warn } from 'kerium/log';
import { isJSON, pick } from 'utilium';
import { Inode } from '../internal/inode.js';
import '../polyfills.js';

export interface WebMessagePort {
	postMessage(value: unknown, transfer?: TransferListItem[]): void;
	addEventListener(type: 'message', listener: (ev: { data: any }) => void): void;
	removeEventListener(type: 'message', listener: (ev: { data: any }) => void): void;
}

export interface NodeMessagePort {
	postMessage(value: unknown, transfer?: TransferListItem[]): void;
	on(type: 'message', listener: (ev: any) => void): void;
	off(type: 'message', listener: (ev: any) => void): void;
}

export type Channel = NodeMessagePort | WebMessagePort | WebSocket;

/** @internal */
export interface Port<T extends Channel = Channel> {
	readonly channel: T;

	/** Send a request */
	send<M extends Message>(message: M, transfer?: TransferListItem[]): void;

	/** Add a response handler */
	addHandler<M extends Message>(handler: (message: M) => void): void;

	/** Remove a response handler */
	removeHandler<M extends Message>(handler: (message: M) => void): void;

	/** Remove all handlers */
	disconnect?(): void;
}

export function isPort<T extends Channel>(port: unknown): port is Port<T> {
	return port != null && typeof port == 'object' && 'channel' in port && 'send' in port && 'addHandler' in port && 'removeHandler' in port;
}

/**
 * Creates a new RPC port from a `Worker` or `MessagePort` that extends `EventTarget`
 */
export function fromWeb<T extends WebMessagePort>(port: T): Port<T> {
	return {
		channel: port,
		send: port.postMessage.bind(port),
		addHandler<M extends Message>(handler: (message: M) => void): void {
			port.addEventListener('message', (event: { data: M }) => handler(event.data));
		},
		removeHandler<M extends Message>(handler: (message: M) => void): void {
			port.removeEventListener('message', (event: { data: M }) => handler(event.data));
		},
	};
}

/**
 * Creates a new RPC port from a Node.js `Worker` or `MessagePort`.
 */
export function fromNode<T extends NodeMessagePort>(port: T): Port<T> {
	return {
		channel: port,
		send: port.postMessage.bind(port),
		addHandler: port.on.bind(port, 'message'),
		removeHandler: port.off.bind(port, 'message'),
	};
}

/**
 * Creates a new RPC port from a WebSocket.
 * @experimental
 */
export function fromWebSocket<T extends WebSocket>(ws: T): Port<T> {
	return {
		channel: ws,
		send(message) {
			ws.send(encodeMessage(message));
		},
		addHandler(handler) {
			ws.addEventListener('message', event => {
				handler(decodeMessage<any>(event.data));
			});
		},
		removeHandler(handler) {
			ws.removeEventListener('message', event => {
				handler(decodeMessage<any>(event.data));
			});
		},
	};
}

export function from<T extends Channel>(port: T | Port<T>): Port<T> {
	if (isPort(port)) return port;
	if (port instanceof WebSocket) return fromWebSocket(port);
	if ('on' in port) return fromNode(port as NodeMessagePort & T);
	if ('addEventListener' in port) return fromWeb(port as WebMessagePort & T);
	throw err(withErrno('EINVAL', 'Invalid port type'));
}

/**
 * The options for the RPC options
 * @category Backends and Configuration
 */
export interface Options {
	/**
	 * The target port that you want to connect to, or the current port if in a port context.
	 */
	port: Port;
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
export interface Methods {
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
	sync(): void;
	read(path: string, buffer: Uint8Array, start: number, end: number): Uint8Array;
	write(path: string, buffer: Uint8Array, offset: number): void;
	stat(path: string): Uint8Array;
}

/**
 * The methods that can be called on the RPC port
 * @category Internals
 * @internal
 */
export type Method = keyof Methods;

/**
 * An RPC message
 * @category Internals
 * @internal
 */
export interface Message {
	_zenfs: true;
	id: string;
	method: Method;
	stack: string;
}

export interface Request<TMethod extends Method = Method> extends Message {
	method: TMethod;
	args: Parameters<Methods[TMethod]>;
}

export interface Response<TMethod extends Method = Method> extends Message {
	error?: WithOptional<ExceptionJSON, 'code' | 'errno'>;
	method: TMethod;

	// Note: This is undefined if an error occurs, and we check it at runtime
	// We don't do the type stuff because Typescript gets confused
	value: ReturnType<Methods[TMethod]>;
}

/*

Notes on encoding:


Buffer prefix ($):

Used to mark when a Uint8Array is encoded into JSON using base64.
These are encoded "special" since by default it becomes {"0":n,"1":n,...}
It shouldn't be possible to forge this since all paths start with / and inodes are serialized as buffers

Message prefix and version (Z...):

Used to indicate that this is a ZenFS message, rather than some 3rd party message.
Immediately following the message prefix is a plain-text version.
This is used in case the encoding changes in the future, so a client and server with mismatched versions can detect it.
*/

const encodingVersion = 1;

/**
 * Encode a RPC message as a string using JSON.
 * This is only done when structured cloning is not available.
 * @internal
 */
export function encodeMessage(message: Message): string {
	return `Z${encodingVersion}${JSON.stringify(message, (key, value) => {
		if (key == '_zenfs') return; // encoded differently
		return value instanceof Uint8Array ? '$' + value.toBase64() : value;
	})}`;
}

/**
 * Decode a RPC message from a string using JSON.
 * This is only done when structured cloning is not available.
 * @internal
 */
export function decodeMessage<T extends Message>(message: string): T {
	if (!message.startsWith('Z')) return {} as T; // ignore not-ZenFS messages
	message = message.slice(1);
	const v = parseInt(message); // hack so we don't have to figure out how long the version is
	if (isNaN(v)) {
		warn('Ignoring encoded message with missing version');
		return {} as T;
	}
	message = message.slice(v.toString().length);
	if (!isJSON(message)) {
		warn('Ignoring encoded message with invalid JSON');
		return {} as T;
	}

	if (v != encodingVersion)
		throw err(withErrno('EPROTONOSUPPORT', `Version mismatch in RPC message encoding (got ${v}, expected ${encodingVersion})`));

	return {
		...JSON.parse(message, (key, value) => (typeof value == 'string' && value.startsWith('$') ? Uint8Array.fromBase64(value.slice(1)) : value)),
		_zenfs: true,
	};
}

export function isMessage(arg: unknown): arg is Message {
	return typeof arg == 'object' && arg != null && '_zenfs' in arg && !!arg._zenfs;
}

function disposeExecutors(id: string): void {
	const executor = executors.get(id);
	if (!executor) return;

	if (executor.timeout) {
		clearTimeout(executor.timeout);
		if (typeof executor.timeout == 'object') executor.timeout.unref();
	}

	executor.fs._executors.delete(id);
	executors.delete(id);
}

/**
 * An RPC executor
 * @internal @hidden
 */
export interface Executor extends PromiseWithResolvers<any> {
	fs: PortFS;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * A map of *all* outstanding RPC requests
 */
const executors: Map<string, Executor> = new Map();

export function request<const TRequest extends Request, TValue>(
	request: Omit<TRequest, 'id' | 'stack' | '_zenfs'>,
	{ port, timeout: ms = 1000, fs }: Partial<Options> & { fs: PortFS }
): Promise<TValue> {
	const stack = '\n' + new Error().stack!.slice('Error:'.length);
	if (!port) throw err(withErrno('EINVAL', 'Can not make an RPC request without a port'));

	const { resolve, reject, promise } = Promise.withResolvers<TValue>();

	const id = Math.random().toString(16).slice(5);
	const timeout = setTimeout(() => {
		const error = err(withErrno('ETIMEDOUT', 'RPC request timed out'));
		error.stack += stack;
		disposeExecutors(id);
		reject(error);
	}, ms);
	const executor: Executor = { resolve, reject, promise, fs, timeout };
	fs._executors.set(id, executor);
	executors.set(id, executor);
	port.send({ ...request, _zenfs: true, id, stack });

	return promise;
}

// Why Typescript, WHY does the type need to be asserted even when the method is explicitly checked?

function __requestMethod<const T extends Method>(req: Request): asserts req is Request<T> {}

function __responseMethod<const R extends Response, const T extends Method>(res: R, ...t: T[]): res is R & Response<T> {
	return t.includes(res.method as T);
}

export function handleResponse<const TMethod extends Method>(response: Response<TMethod>): void {
	if (!isMessage(response)) return;

	if (!executors.has(response.id)) {
		const error = err(withErrno('EIO', 'Invalid RPC id: ' + response.id));
		error.stack += response.stack;
		throw error;
	}

	const { resolve, reject } = executors.get(response.id)!;
	if (response.error) {
		const e = Exception.fromJSON({ code: 'EIO', errno: Errno.EIO, ...response.error });
		e.stack += response.stack;
		disposeExecutors(response.id);
		reject(e);
		return;
	}

	disposeExecutors(response.id);
	resolve(__responseMethod(response, 'stat', 'createFile', 'mkdir') ? new Inode(response.value) : response.value);
	return;
}

export function attach<T extends Message>(port: Port, handler: (message: T) => unknown) {
	if (!port) throw err(withErrno('EINVAL', 'Cannot attach to non-existent port'));
	info('Attached handler to port: ' + handler.name);
	port.addHandler(handler);
}

export function detach<T extends Message>(port: Port, handler: (message: T) => unknown) {
	if (!port) throw err(withErrno('EINVAL', 'Cannot detach from non-existent port'));
	info('Detached handler from port: ' + handler.name);
	port.removeHandler(handler);
}

export function catchMessages<T extends Backend>(port: Port): (fs: FilesystemOf<T>) => Promise<void> {
	const events: any[] = [];
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

/** @internal */
export async function handleRequest(port: Port, fs: FileSystem & { _descriptors?: Map<number, File> }, request: Request): Promise<void> {
	if (!isMessage(request)) return;

	let value, error: ExceptionJSON | Pick<Error, 'message' | 'stack'> | undefined;
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
				const md = await fs[request.method](...request.args);
				const inode = md instanceof Inode ? md : new Inode(md);
				value = new Uint8Array(inode.buffer, inode.byteOffset, inode.byteLength);
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
				value = (await fs[request.method](...request.args)) as ReturnType<Methods[TMethod]>;
		}
	} catch (e: any) {
		error = e instanceof Exception ? e.toJSON() : pick(e, 'message', 'stack');
	}

	port.send({ _zenfs: true, ...pick(request, 'id', 'method', 'stack'), error, value }, transferList);
}
