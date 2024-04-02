import type { File } from '@zenfs/core';
import type { FileSystem, FileSystemMetadata } from '@zenfs/core/filesystem.js';
import type { TransferListItem } from 'worker_threads';

/**
 * An RPC message
 */
export interface Message {
	_zenfs: true;
	id: number;
	scope: string;
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
type ExtractProperties<T, P> = {
	[K in keyof T as T[K] extends infer Prop ? (Prop extends P ? K : never) : never]: T[K];
};

type FSAsyncMethods = ExtractProperties<FileSystem, (...args: unknown[]) => Promise<unknown> | FileSystemMetadata>;

export type FSMethod = keyof FSAsyncMethods;

type FSRequests = {
	[M in FSMethod]: {
		_zenfs: true;
		scope: 'fs';
		id: number;
		method: M;
		stack: string;
		args: Parameters<FSAsyncMethods[M]>;
	};
};

type FSResponses = {
	[M in FSMethod]: {
		_zenfs: true;
		scope: 'fs';
		id: number;
		error: boolean;
		method: M;
		stack: string;
		value: Awaited<ReturnType<FSAsyncMethods[M]>>;
	};
};

export type FSRequest<T extends FSMethod = FSMethod> = FSRequests[T];
export type FSArgs<T extends FSMethod = FSMethod> = FSRequests[T]['args'];
export type FSResponse<T extends FSMethod = FSMethod> = FSResponses[T]['value'] extends File ? Omit<FSResponses[T], 'value'> & { fd: number } : FSResponses[T];
export type FSValue<T extends FSMethod = FSMethod> = Promise<FSResponses[T]['value']>;

export interface FileData {
	fd: number;
	path: string;
	position: number;
}

export { FileData as File };

type FileAsyncMethods = ExtractProperties<File, (...args: unknown[]) => Promise<unknown>>;

export type FileMethod = keyof FileAsyncMethods;

type FileRequests = {
	[M in FileMethod]: {
		_zenfs: true;
		scope: 'file';
		id: number;
		fd: number;
		method: M;
		stack: string;
		args: Parameters<FileAsyncMethods[M]>;
	};
};

type FileResponses = {
	[M in FileMethod]: {
		_zenfs: true;
		scope: 'file';
		id: number;
		fd: number;
		error: boolean;
		method: M;
		stack: string;
		value: Awaited<ReturnType<FileAsyncMethods[M]>>;
	};
};

export type FileRequest<T extends FileMethod = FileMethod> = FileRequests[T];
export type FileArgs<T extends FileMethod = FileMethod> = FileRequests[T]['args'];
export type FileResponse<T extends FileMethod = FileMethod> = FileResponses[T];
export type FileValue<T extends FileMethod = FileMethod> = Promise<FileResponses[T]['value']>;

export type Request = FSRequest | FileRequest;
export type Args = FSRequest['args'] | FileRequest['args'];
export type Response = FSResponse | FileResponse;
export type Value = Promise<FSResponse['value']> | Promise<FileResponse['value']>;

export function isMessage(arg: unknown): arg is Message {
	return typeof arg == 'object' && '_zenfs' in arg && !!arg._zenfs;
}

type Executor = Parameters<ConstructorParameters<typeof Promise>[0]>;

export interface RequestPromise {
	resolve: Executor[0];
	reject: Executor[1];
}
