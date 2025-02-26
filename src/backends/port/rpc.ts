/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Worker as NodeWorker, TransferListItem } from 'node:worker_threads';
import type { WithOptional } from 'utilium';
import type { ErrnoErrorJSON } from '../../internal/error.js';
import type { FileSystem } from '../../internal/filesystem.js';
import type { Backend, FilesystemOf } from '../backend.js';
import type { PortFS } from './fs.js';

import { Errno, ErrnoError } from '../../internal/error.js';
import { err, info } from '../../internal/log.js';
import { handleRequest } from './fs.js';

type _MessageEvent<T = any> = T | { data: T };

/** @internal */
export interface Port {
	postMessage(value: unknown, transfer?: TransferListItem[]): void;
	on?(event: 'message' | 'online', listener: (value: unknown) => void): this;
	off?(event: 'message', listener: (value: unknown) => void): this;
	addEventListener?(type: 'message', listener: (ev: _MessageEvent) => void): void;
	removeEventListener?(type: 'message', listener: (ev: _MessageEvent) => void): void;
}

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
 * An RPC message
 */
export interface Message {
	_zenfs: true;
	id: string;
	method: string;
	stack: string;
}

export interface Request extends Message {
	args: unknown[];
}

interface _ResponseWithError extends Message {
	error: true;
	value: WithOptional<ErrnoErrorJSON, 'code' | 'errno'>;
}

interface _ResponseWithValue<T> extends Message {
	error: false;
	value: Awaited<T>;
}

interface _ResponseRead extends Message {
	error: false;
	method: 'read';
	value: Uint8Array;
}

export type Response<T = unknown> = _ResponseWithError | _ResponseWithValue<T> | _ResponseRead;

// general types

export function isMessage(arg: unknown): arg is Message {
	return typeof arg == 'object' && arg != null && '_zenfs' in arg && !!arg._zenfs;
}

type _Executor = Parameters<ConstructorParameters<typeof Promise<any>>[0]>;

export interface Executor {
	resolve: _Executor[0];
	reject: _Executor[1];
	fs?: PortFS;
}

const executors: Map<string, Executor> = new Map();

export function request<const TRequest extends Request, TValue>(
	request: Omit<TRequest, 'id' | 'stack' | '_zenfs'>,
	{ port, timeout = 1000, fs }: Partial<Options> & { fs?: PortFS } = {}
): Promise<TValue> {
	const stack = '\n' + new Error().stack!.slice('Error:'.length);
	if (!port) throw err(new ErrnoError(Errno.EINVAL, 'Can not make an RPC request without a port'));

	return new Promise<TValue>((resolve, reject) => {
		const id = Math.random().toString(16).slice(10);
		executors.set(id, { resolve, reject, fs });
		port.postMessage({ ...request, _zenfs: true, id, stack });
		const _ = setTimeout(() => {
			const error = err(new ErrnoError(Errno.EIO, 'RPC Failed', typeof request.args[0] == 'string' ? request.args[0] : '', request.method), {
				fs,
			});
			error.stack += stack;
			reject(error);
			if (typeof _ == 'object') _.unref();
		}, timeout);
	});
}

export function handleResponse<const TResponse extends Response>(response: TResponse): void {
	if (!isMessage(response)) {
		return;
	}
	const { id, value, error, stack } = response;
	if (!executors.has(id)) {
		const error = err(new ErrnoError(Errno.EIO, 'Invalid RPC id:' + id));
		error.stack += stack;
		throw error;
	}
	const { resolve, reject, fs } = executors.get(id)!;
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

export function attach<T extends Message>(port: Port, handler: (message: T) => unknown) {
	if (!port) throw err(new ErrnoError(Errno.EINVAL, 'Cannot attach to non-existent port'));
	info('Attached handler to port: ' + handler.name);

	port['on' in port ? 'on' : 'addEventListener']!('message', (message: T | _MessageEvent<T>) => {
		handler(typeof message == 'object' && message !== null && 'data' in message ? message.data : message);
	});
}

export function detach<T extends Message>(port: Port, handler: (message: T) => unknown) {
	if (!port) throw err(new ErrnoError(Errno.EINVAL, 'Cannot detach from non-existent port'));
	info('Detached handler from port: ' + handler.name);

	port['off' in port ? 'off' : 'removeEventListener']!('message', (message: T | _MessageEvent<T>) => {
		handler(typeof message == 'object' && message !== null && 'data' in message ? message.data : message);
	});
}

export function catchMessages<T extends Backend>(port: Port): (fs: FilesystemOf<T>) => Promise<void> {
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
export async function waitOnline(port: Port): Promise<void> {
	if (!('on' in port)) return; // Only need to wait in Node.js
	const online = Promise.withResolvers<void>();
	setTimeout(online.reject, 500);
	(port as NodeWorker).on('online', online.resolve);
	await online.promise;
}
