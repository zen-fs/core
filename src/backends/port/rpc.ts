/* eslint-disable @typescript-eslint/no-explicit-any */
import { Errno, ErrnoError, type ErrnoErrorJSON } from '../../error.ts';
import type { Backend, FilesystemOf } from '../backend.ts';
import type { FileOrFSRequest } from './fs.ts';
import { handleRequest, PortFile, type PortFS } from './fs.ts';

type _MessageEvent<T = any> = T | { data: T };

/** @internal */
export interface Port {
	postMessage(value: unknown): void;
	on?(event: 'message', listener: (value: unknown) => void): this;
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
	scope: 'fs' | 'file';
	id: string;
	method: string;
	stack: string;
}

export interface Request extends Message {
	args: unknown[];
}

interface _ResponseWithError extends Message {
	error: true;
	value: ErrnoErrorJSON | string;
}

interface _ResponseWithValue<T> extends Message {
	error: false;
	value: Awaited<T> extends File ? FileData : Awaited<T>;
}

export type Response<T = unknown> = _ResponseWithError | _ResponseWithValue<T>;

export interface FileData {
	fd: number;
	path: string;
	position: number;
}

function isFileData(value: unknown): value is FileData {
	return typeof value == 'object' && value != null && 'fd' in value && 'path' in value && 'position' in value;
}

export { FileData as File };

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
	if (!port) {
		throw ErrnoError.With('EINVAL');
	}
	return new Promise<TValue>((resolve, reject) => {
		const id = Math.random().toString(16).slice(10);
		executors.set(id, { resolve, reject, fs });
		port.postMessage({ ...request, _zenfs: true, id, stack });
		const _ = setTimeout(() => {
			const error = new ErrnoError(Errno.EIO, 'RPC Failed');
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
		const error = new ErrnoError(Errno.EIO, 'Invalid RPC id:' + id);
		error.stack += stack;
		throw error;
	}
	const { resolve, reject, fs } = executors.get(id)!;
	if (error) {
		const e = typeof value == 'string' ? new Error(value) : ErrnoError.fromJSON(value);
		e.stack += stack;
		reject(e);
		executors.delete(id);
		return;
	}

	if (isFileData(value)) {
		const { fd, path, position } = value;
		const file = new PortFile(fs!, fd, path, position);
		resolve(file);
		executors.delete(id);
		return;
	}

	resolve(value);
	executors.delete(id);
	return;
}

export function attach<T extends Message>(port: Port, handler: (message: T) => unknown) {
	if (!port) {
		throw ErrnoError.With('EINVAL');
	}
	port['on' in port ? 'on' : 'addEventListener']!('message', (message: T | _MessageEvent<T>) => {
		handler('data' in message ? message.data : message);
	});
}

export function detach<T extends Message>(port: Port, handler: (message: T) => unknown) {
	if (!port) {
		throw ErrnoError.With('EINVAL');
	}
	port['off' in port ? 'off' : 'removeEventListener']!('message', (message: T | _MessageEvent<T>) => {
		handler('data' in message ? message.data : message);
	});
}

export function catchMessages<T extends Backend>(port: Port): (fs: FilesystemOf<T>) => void {
	const events: _MessageEvent[] = [];
	const handler = events.push.bind(events);
	attach(port, handler);
	return function (fs: any) {
		detach(port, handler);
		for (const event of events) {
			const request: FileOrFSRequest = 'data' in event ? event.data : event;
			void handleRequest(port, fs, request);
		}
	};
}
