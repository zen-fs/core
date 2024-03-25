import type { File } from '@zenfs/core/file.js';
import type { FileSystem, FileSystemMetadata } from '@zenfs/core/filesystem.js';

/**
 * An RPC message
 */
export interface RPCMessage {
	isBFS: true;
	id: number;
}

export type _FSAsyncMethods = {
	[Method in keyof FileSystem]: Extract<FileSystem[Method], (...args: unknown[]) => Promise<unknown>>;
};

export type _RPCFSRequests = {
	[Method in keyof _FSAsyncMethods]: { method: Method; args: Parameters<_FSAsyncMethods[Method]> };
};

export type _RPCFSResponses = {
	[Method in keyof _FSAsyncMethods]: { method: Method; value: Awaited<ReturnType<_FSAsyncMethods[Method]>> };
};

/**
 * @see https://stackoverflow.com/a/60920767/17637456
 */
export type RPCRequest = RPCMessage & (_RPCFSRequests[keyof _FSAsyncMethods] | { method: 'metadata'; args: [] } | { method: 'syncClose'; args: [string, File] });

export type RPCResponse = RPCMessage & (_RPCFSResponses[keyof _FSAsyncMethods] | { method: 'metadata'; value: FileSystemMetadata } | { method: 'syncClose'; value: null });

export function isRPCMessage(arg: unknown): arg is RPCMessage {
	return typeof arg == 'object' && 'isBFS' in arg && !!arg.isBFS;
}

type PromiseExecutor = Parameters<ConstructorParameters<typeof Promise>[0]>;

export interface WorkerRequest {
	resolve: PromiseExecutor[0];
	reject: PromiseExecutor[1];
}
