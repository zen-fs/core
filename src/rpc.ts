import { ApiError, ErrorCode, type File } from '@zenfs/core';
import type { FileSystem, FileSystemMetadata } from '@zenfs/core/filesystem.js';
import type { TransferListItem } from 'worker_threads';
import { type PortFS } from './fs.js';
import { PortFile } from './file.js';

/**
 * An RPC message
 */
export interface Message<TScope extends string, TMethod extends string> {
	_zenfs: true;
	scope: TScope;
	id: number;
	method: TMethod;
	stack: string;
}

export interface BaseRequest<TScope extends string, TMethod extends string, TArgs extends unknown[]> extends Message<TScope, TMethod> {
	args: TArgs;
}

export interface BaseResponse<TScope extends string, TMethod extends string, TValue> extends Message<TScope, TMethod> {
	error: boolean;
	value: Awaited<TValue>;
}

export interface Port {
	postMessage(value: unknown, transferList?: ReadonlyArray<TransferListItem>): void;
	on?(event: 'message', listener: (value: unknown) => void): this;
	addEventListener?(type: 'message', listener: (this: Port, ev: MessageEvent) => void): void;
	onmessage?: ((this: Port, ev: MessageEvent) => void) | null;
}

/**
 * Extracts an object of properties assignable to P from an object T
 */
export type ExtractProperties<T, P> = {
	[K in keyof T as T[K] extends infer Prop ? (Prop extends P ? K : never) : never]: T[K];
};

// Remote file system

type FSAsyncMethods = ExtractProperties<FileSystem, (...args: unknown[]) => Promise<unknown> | FileSystemMetadata>;

export type FSMethod = keyof FSAsyncMethods;
export type FSArgs<TMethod extends FSMethod = FSMethod> = Parameters<FSAsyncMethods[TMethod]>;
export type FSRequest<TMethod extends FSMethod = FSMethod> = BaseRequest<'fs', TMethod, FSArgs<TMethod>>;
export type FSValue<TMethod extends FSMethod = FSMethod> = Awaited<ReturnType<FSAsyncMethods[TMethod]>>;
export type FSResponse<TMethod extends FSMethod = FSMethod> = BaseResponse<'fs', TMethod, FSValue<TMethod> extends File ? FileData : FSValue<TMethod>>;

// Remote file

export interface FileData {
	fd: number;
	path: string;
	position: number;
}

function isFileData(value: unknown): value is FileData {
	return typeof value == 'object' && 'fd' in value && 'path' in value && 'position' in value;
}

export { FileData as File };

type FileAsyncMethods = ExtractProperties<File, (...args: unknown[]) => Promise<unknown>>;

export type FileMethod = keyof FileAsyncMethods;
export type FileArgs<TMethod extends FileMethod = FileMethod> = Parameters<FileAsyncMethods[TMethod]>;
export interface FileRequest<TMethod extends FileMethod = FileMethod> extends BaseRequest<'file', TMethod, FileArgs<TMethod>> {
	fd: number;
}
export type FileValue<TMethod extends FileMethod = FileMethod> = Awaited<ReturnType<FileAsyncMethods[TMethod]>>;
export interface FileResponse<TMethod extends FileMethod = FileMethod> extends BaseResponse<'file', TMethod, FileValue<TMethod>> {
	fd: number;
}

// general types

export type Request = FSRequest | FileRequest;
export type Args = FSArgs | FileArgs;
export type Response = FSResponse | FileResponse;
export type Value = FSValue | FileValue;

export function isMessage(arg: unknown): arg is Message<string, string> {
	return typeof arg == 'object' && '_zenfs' in arg && !!arg._zenfs;
}

type _Executor = Parameters<ConstructorParameters<typeof Promise>[0]>;

export interface Executor {
	resolve: _Executor[0];
	reject: _Executor[1];
}

const executors: Map<number, Executor> = new Map();

let next = 0;

export interface RequestOptions {
	timeout: number;
}

export function request<const TRequest extends BaseRequest<string, string, unknown[]>, TValue>(port: Port, request: Omit<TRequest, 'id' | 'stack'>, { timeout = 1000 }: Partial<RequestOptions> = {}): Promise<TValue> {
	return new Promise<TValue>((resolve, reject) => {
		const id = next++;
		executors.set(id, { resolve, reject });
		port.postMessage({
			...request,
			id,
			stack:  new Error().stack.slice('Error:'.length),
		});
		setTimeout(() => {
			reject(new ApiError(ErrorCode.EIO, 'RPC Failed'));
		}, timeout);
	});
}

export function handleResponse<const TResponse extends BaseResponse<string, string, unknown>>(response: MessageEvent<TResponse> | TResponse, fs?: PortFS): TResponse {
	const data: TResponse = 'data' in response ? response.data : response;
	if (!isMessage(data)) {
		return;
	}
	const { id, value, error, stack } = data;
	const { resolve, reject } = executors.get(id);
	if (error) {
		const e = <ApiError>(<unknown>value);
		e.stack += stack;
		reject(e);
		executors.delete(id);
		return data;
	}

	if (isFileData(value)) {
		const { fd, path, position } = <FileData>(<unknown>value);
		const file = new PortFile(fs, fd, path, position);
		resolve(file);
		executors.delete(id);
		return data;
	}

	resolve(value);
	executors.delete(id);
	return data;
}
