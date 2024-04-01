import { Cred } from '@zenfs/core/cred.js';
import { File, FileFlag } from '@zenfs/core/file.js';
import { Async, FileSystem, type FileSystemMetadata } from '@zenfs/core/filesystem.js';
import { Stats } from '@zenfs/core/stats.js';
import type { Worker as NodeWorker } from 'worker_threads';
import { isRPCMessage, type RPCArgs, type RPCMethod, type RPCResponse, type RPCValue, type PromiseResolve } from './rpc.js';

export interface WorkerFSOptions {
	/**
	 * The target worker that you want to connect to, or the current worker if in a worker context.
	 */
	worker: Worker | NodeWorker;
}

/**
 * WorkerFS lets you access a ZenFS instance that is running in a worker, or the other way around.
 *
 * Note that synchronous operations are not permitted on the WorkerFS, regardless
 * of the configuration option of the remote FS.
 */
export class WorkerFS extends Async(FileSystem) {
	protected _worker: Worker | NodeWorker;
	protected _currentID: number = 0;
	protected _requests: Map<number, PromiseResolve> = new Map();

	protected handleMessage(message: MessageEvent<RPCResponse> | RPCResponse) {
		const data: RPCResponse = 'data' in message ? message.data : message;
		if (!isRPCMessage(data)) {
			return;
		}
		const { id, value } = data;
		const resolve = this._requests.get(id);

		resolve(value);
	}

	/**
	 * Constructs a new WorkerFS instance that connects with ZenFS running on
	 * the specified worker.
	 */
	public constructor({ worker }: WorkerFSOptions) {
		super();
		this._worker = worker;
		worker['on' in worker ? 'on' : 'addEventListener']('message', msg => {
			this.handleMessage(msg);
		});
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: 'WorkerFS',
			synchronous: false,
		};
	}

	protected async _rpc<const T extends RPCMethod>(method: T, ...args: RPCArgs<T>): RPCValue<T> {
		return new Promise(resolve => {
			const id = this._currentID++;
			this._requests.set(id, resolve);
			this._worker.postMessage({
				_zenfs: true,
				id,
				method,
				args,
			});
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
}
