/* eslint-disable @typescript-eslint/no-explicit-any */
/// !<reference lib="DOM" />
import type { TransferListItem } from 'worker_threads';
import { ApiError, ErrorCode, type ApiErrorJSON } from '../../ApiError.js';
import { PortFile, type PortFS } from './fs.js';

type _MessageEvent<T = any> = T | { data: T };

export interface Port {
	postMessage(value: unknown, transferList?: ReadonlyArray<TransferListItem>): void;
	on?(event: 'message', listener: (value: unknown) => void): this;
	off?(event: 'message', listener: (value: unknown) => void): this;
	addEventListener?(type: 'message', listener: (this: Port, ev: _MessageEvent) => void): void;
	removeEventListener?(type: 'message', listener: (this: Port, ev: _MessageEvent) => void): void;
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
export interface Message<TScope extends string = string, TMethod extends string = string> {
	_zenfs: true;
	scope: TScope;
	id: string;
	method: TMethod;
	stack: string;
}

export interface Request<TScope extends string = string, TMethod extends string = string, TArgs extends unknown[] = unknown[]> extends Message<TScope, TMethod> {
	args: TArgs;
}

export interface Response<TScope extends string = string, TMethod extends string = string, TValue = unknown> extends Message<TScope, TMethod> {
	error: boolean;
	value: Awaited<TValue> extends File ? FileData : Awaited<TValue>;
}

export interface FileData {
	fd: number;
	path: string;
	position: number;
}

function isFileData(value: unknown): value is FileData {
	return typeof value == 'object' && value !== null && 'fd' in value && 'path' in value && 'position' in value;
}

export { FileData as File };

// general types

export function isMessage(arg: unknown): arg is Message<string, string> {
	return typeof arg == 'object' && arg !== null && '_zenfs' in arg && !!arg._zenfs;
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
	const stack = new Error().stack!.slice('Error:'.length);
	if (!port) {
		throw ApiError.With('EINVAL');
	}
	return new Promise<TValue>((resolve, reject) => {
		const id = Math.random().toString(16).slice(10);
		executors.set(id, { resolve, reject, fs });
		port.postMessage({
			...request,
			_zenfs: true,
			id,
			stack,
		});
		setTimeout(() => {
			const error = new ApiError(ErrorCode.EIO, 'RPC Failed');
			error.stack += stack;
			reject(error);
		}, timeout);
	});
}

export function handleResponse<const TResponse extends Response>(response: TResponse): TResponse | undefined {
	if (!isMessage(response)) {
		return;
	}
	const { id, value, error, stack } = response;
	if (!executors.has(id)) {
		const error = new ApiError(ErrorCode.EIO, 'Invalid RPC id:' + id);
		error.stack += stack;
		throw error;
	}
	const { resolve, reject, fs } = executors.get(id)!;
	if (error) {
		const e = ApiError.fromJSON(value as ApiErrorJSON);
		e.stack += stack;
		reject(e);
		executors.delete(id);
		return response;
	}

	if (isFileData(value)) {
		const { fd, path, position } = <FileData>(<unknown>value);
		const file = new PortFile(fs!, fd, path, position);
		resolve(file);
		executors.delete(id);
		return response;
	}

	resolve(value);
	executors.delete(id);
	return response;
}

export function attach<T extends Message>(port: Port, handler: (message: T) => unknown) {
	if (!port) {
		throw ApiError.With('EINVAL');
	}
	port['on' in port ? 'on' : 'addEventListener']!('message', (message: T | _MessageEvent<T>) => {
		handler('data' in message ? message.data : message);
	});
}

export function detach<T extends Message>(port: Port, handler: (message: T) => unknown) {
	if (!port) {
		throw ApiError.With('EINVAL');
	}
	port['off' in port ? 'off' : 'removeEventListener']!('message', (message: T | _MessageEvent<T>) => {
		handler('data' in message ? message.data : message);
	});
}
