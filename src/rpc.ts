import type { FileSystem, FileSystemMetadata } from '@zenfs/core/filesystem.js';
import type { TransferListItem } from 'worker_threads';

/**
 * An RPC message
 */
export interface RPCMessage {
	_zenfs: true;
	id: number;
}

export interface RPCWorker {
	postMessage(value: unknown, transferList?: ReadonlyArray<TransferListItem>): void;
	on?(event: 'message', listener: (value: unknown) => void): this;
	addEventListener?(type: 'message', listener: (this: RPCWorker, ev: MessageEvent) => void): void;
	onmessage?: ((this: Worker, ev: MessageEvent) => void) | null;
}

/**
 * Extracts an object of properties assignable to P from an object T
 */
type ExtractProperties<T, P> = {
	[K in keyof T as T[K] extends infer Prop ? (Prop extends P ? K : never) : never]: T[K];
};

type FSAsyncMethods = ExtractProperties<FileSystem, (...args: unknown[]) => Promise<unknown> | FileSystemMetadata>;

export type RPCMethod = keyof FSAsyncMethods;

export type RPCRequests = {
	[Method in RPCMethod]: { _zenfs: true; id: number; method: Method; args: Parameters<FSAsyncMethods[Method]> };
};

export type RPCResponses = {
	[Method in RPCMethod]: RPCMessage & { method: Method; value: Awaited<ReturnType<FSAsyncMethods[Method]>> };
};

export type RPCRequest<T extends RPCMethod = RPCMethod> = RPCRequests[T];

export type RPCArgs<T extends RPCMethod = RPCMethod> = RPCRequests[T]['args'];

export type RPCResponse<T extends RPCMethod = RPCMethod> = RPCResponses[T];

export type RPCValue<T extends RPCMethod = RPCMethod> = Promise<RPCResponses[T]['value']>;

export function isRPCMessage(arg: unknown): arg is RPCMessage {
	return typeof arg == 'object' && '_zenfs' in arg && !!arg._zenfs;
}

export type PromiseResolve = Parameters<ConstructorParameters<typeof Promise>[0]>[0];
