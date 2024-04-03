import { Cred } from '@zenfs/core/cred.js';
import { File } from '@zenfs/core/file.js';
import { Async, FileSystem, type FileSystemMetadata } from '@zenfs/core/filesystem.js';
import { Stats } from '@zenfs/core/stats.js';
import * as RPC from './rpc.js';

export interface PortFSOptions extends Partial<RPC.Options> {
	/**
	 * The target port that you want to connect to, or the current port if in a port context.
	 */
	port: RPC.Port;
}

/**
 * PortFS lets you access a ZenFS instance that is running in a port, or the other way around.
 *
 * Note that synchronous operations are not permitted on the PortFS, regardless
 * of the configuration option of the remote FS.
 */
export class PortFS extends Async(FileSystem) {
	public readonly port: RPC.Port;
	public readonly options: Partial<RPC.Options>;

	/**
	 * Constructs a new PortFS instance that connects with ZenFS running on
	 * the specified port.
	 */
	public constructor({ port, ...options }: PortFSOptions) {
		super();
		this.port = port;
		this.options = options;
		port['on' in port ? 'on' : 'addEventListener']('message', (message: RPC.Response) => {
			RPC.handleResponse(message, this);
		});
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: 'PortFS',
			synchronous: false,
		};
	}

	protected rpc<const T extends RPC.FSMethod>(method: T, ...args: RPC.FSArgs<T>): Promise<RPC.FSValue<T>> {
		return RPC.request<RPC.FSRequest<T>, RPC.FSValue<T>>(this.port, {
			scope: 'fs',
			method,
			args,
		});
	}

	public async ready(): Promise<this> {
		await this.rpc('ready');
		return this;
	}

	public rename(oldPath: string, newPath: string, cred: Cred): Promise<void> {
		return this.rpc('rename', oldPath, newPath, cred);
	}
	public async stat(p: string, cred: Cred): Promise<Stats> {
		return new Stats(await this.rpc('stat', p, cred));
	}
	public sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
		return this.rpc('sync', path, data, stats);
	}
	public openFile(p: string, flag: string, cred: Cred): Promise<File> {
		return this.rpc('openFile', p, flag, cred);
	}
	public createFile(p: string, flag: string, mode: number, cred: Cred): Promise<File> {
		return this.rpc('createFile', p, flag, mode, cred);
	}
	public unlink(p: string, cred: Cred): Promise<void> {
		return this.rpc('unlink', p, cred);
	}
	public rmdir(p: string, cred: Cred): Promise<void> {
		return this.rpc('rmdir', p, cred);
	}
	public mkdir(p: string, mode: number, cred: Cred): Promise<void> {
		return this.rpc('mkdir', p, mode, cred);
	}
	public readdir(p: string, cred: Cred): Promise<string[]> {
		return this.rpc('readdir', p, cred);
	}
	public exists(p: string, cred: Cred): Promise<boolean> {
		return this.rpc('exists', p, cred);
	}
	public link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		return this.rpc('link', srcpath, dstpath, cred);
	}
}
