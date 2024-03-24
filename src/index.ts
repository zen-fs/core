import { Async, FileSystem, type FileSystemMetadata } from '@zenfs/core/filesystem.js';
import { ApiError, ErrorCode } from '@zenfs/core/ApiError.js';
import { File, FileFlag } from '@zenfs/core/file.js';
import { Stats } from '@zenfs/core/stats.js';
import { Cred } from '@zenfs/core/cred.js';
import type { Backend } from '@zenfs/core/backends/backend.js';

/**
 * @hidden
 */
declare const importScripts: (...path: string[]) => unknown;

/**
 * An RPC message
 */
interface RPCMessage {
	isBFS: true;
	id: number;
}

type _FSAsyncMethods = {
	[Method in keyof FileSystem]: Extract<FileSystem[Method], (...args: unknown[]) => Promise<unknown>>;
};

type _RPCFSRequests = {
	[Method in keyof _FSAsyncMethods]: { method: Method; args: Parameters<_FSAsyncMethods[Method]> };
};

type _RPCFSResponses = {
	[Method in keyof _FSAsyncMethods]: { method: Method; value: Awaited<ReturnType<_FSAsyncMethods[Method]>> };
};

/**
 * @see https://stackoverflow.com/a/60920767/17637456
 */
type RPCRequest = RPCMessage & (_RPCFSRequests[keyof _FSAsyncMethods] | { method: 'metadata'; args: [] } | { method: 'syncClose'; args: [string, File] });

type RPCResponse = RPCMessage & (_RPCFSResponses[keyof _FSAsyncMethods] | { method: 'metadata'; value: FileSystemMetadata } | { method: 'syncClose'; value: null });

function isRPCMessage(arg: unknown): arg is RPCMessage {
	return typeof arg == 'object' && 'isBFS' in arg && !!arg.isBFS;
}

type _executor = Parameters<ConstructorParameters<typeof Promise>[0]>;
interface WorkerRequest {
	resolve: _executor[0];
	reject: _executor[1];
}

export namespace WorkerFS {
	export interface Options {
		/**
		 * The target worker that you want to connect to, or the current worker if in a worker context.
		 */
		worker: Worker;
	}
}

type _RPCExtractReturnValue<T extends RPCResponse['method']> = Promise<Extract<RPCResponse, { method: T }>['value']>;

/**
 * WorkerFS lets you access a ZenFS instance that is running in a different
 * JavaScript context (e.g. access ZenFS in one of your WebWorkers, or
 * access ZenFS running on the main page from a WebWorker).
 *
 * For example, to have a WebWorker access files in the main browser thread,
 * do the following:
 *
 * MAIN BROWSER THREAD:
 *
 * ```javascript
 *   // Listen for remote file system requests.
 *   ZenFS.Backend.WorkerFS.attachRemoteListener(webWorkerObject);
 * ```
 *
 * WEBWORKER THREAD:
 *
 * ```javascript
 *   // Set the remote file system as the root file system.
 *   ZenFS.configure({ fs: "WorkerFS", options: { worker: self }}, function(e) {
 *     // Ready!
 *   });
 * ```
 *
 * Note that synchronous operations are not permitted on the WorkerFS, regardless
 * of the configuration option of the remote FS.
 */
export class WorkerFS extends Async(FileSystem) {

	private _worker: Worker;
	private _currentID: number = 0;
	private _requests: Map<number, WorkerRequest> = new Map();

	private _isInitialized: boolean = false;
	private _metadata: FileSystemMetadata;

	/**
	 * Constructs a new WorkerFS instance that connects with ZenFS running on
	 * the specified worker.
	 */
	public constructor({ worker }: WorkerFS.Options) {
		super();
		this._worker = worker;
		this._worker.onmessage = (event: MessageEvent) => {
			if (!isRPCMessage(event.data)) {
				return;
			}
			const { id, method, value } = event.data as RPCResponse;

			if (method === 'metadata') {
				this._metadata = value;
				this._isInitialized = true;
				return;
			}

			const { resolve, reject } = this._requests.get(id);
			this._requests.delete(id);
			if (value instanceof Error || value instanceof ApiError) {
				reject(value);
				return;
			}
			resolve(value);
		};
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			...this._metadata,
			name: 'WorkerFS',
			synchronous: false,
		};
	}

	private async _rpc<T extends RPCRequest['method']>(method: T, ...args: Extract<RPCRequest, { method: T }>['args']): _RPCExtractReturnValue<T> {
		return new Promise((resolve, reject) => {
			const id = this._currentID++;
			this._requests.set(id, { resolve, reject });
			this._worker.postMessage({
				isBFS: true,
				id,
				method,
				args,
			} as RPCRequest);
		});
	}
	public async ready(): Promise<this> {
		await this._rpc('ready');
		return this;
	}
	public rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		return this._rpc('rename', oldPath, newPath, cred);
	}
	public stat(p: string, cred: Cred): Promise<Stats> {
		return this._rpc('stat', p, cred);
	}
	public sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		return this._rpc('sync', path, data, stats);
	}
	public openFile(p: string, flag: FileFlag, cred: Cred): Promise<File> {
		return this._rpc('openFile', p, flag, cred);
	}
	public createFile(p: string, flag: FileFlag, mode: number, cred: Cred): Promise<File> {
		return this._rpc('createFile', p, flag, mode, cred);
	}
	public unlink(p: string, cred: Cred): Promise<void> {
		return this._rpc('unlink', p, cred);
	}
	public rmdir(p: string, cred: Cred): Promise<void> {
		return this._rpc('rmdir', p, cred);
	}
	public mkdir(p: string, mode: number, cred: Cred): Promise<void> {
		return this._rpc('mkdir', p, mode, cred);
	}
	public readdir(p: string, cred: Cred): Promise<string[]> {
		return this._rpc('readdir', p, cred);
	}
	public exists(p: string, cred: Cred): Promise<boolean> {
		return this._rpc('exists', p, cred);
	}
	public link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		return this._rpc('link', srcpath, dstpath, cred);
	}

	public syncClose(method: string, fd: File): Promise<void> {
		return this._rpc('syncClose', method, fd);
	}
}

export const Worker: Backend = {
	name: 'WorkerFS',

	options: {
		worker: {
			type: 'object',
			description: 'The target worker that you want to connect to, or the current worker if in a worker context.',
			validator(worker: Worker) {
				// Check for a `postMessage` function.
				if (typeof worker?.postMessage != 'function') {
					throw new ApiError(ErrorCode.EINVAL, 'option must be a Web Worker instance.');
				}
			},
		},
	},

	isAvailable(): boolean {
		return typeof importScripts !== 'undefined' || typeof Worker !== 'undefined';
	},

	create(options: WorkerFS.Options) {
		return new WorkerFS(options);
	},
}