import { File } from '@zenfs/core/file.js';
import type { Stats, FileType } from '@zenfs/core/stats.js';
import { ApiError, ErrorCode } from '@zenfs/core';
import type { PortFS } from './fs.js';
import * as RPC from './rpc.js';

export class PortFile extends File {
	constructor(
		public readonly fs: PortFS,
		public readonly fd: number,
		public readonly path: string,
		public position?: number
	) {
		super();
	}

	public rpc<const T extends RPC.FileMethod>(method: T, ...args: RPC.FileArgs<T>): Promise<RPC.FileValue<T>> {
		return RPC.request<RPC.FileRequest<T>, RPC.FileValue<T>>(this.fs.port, {
			_zenfs: true,
			scope: 'file',
			fd: this.fd,
			method,
			args,
		});
	}

	public stat(): Promise<Stats> {
		return this.rpc('stat');
	}

	public statSync(): Stats {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public truncate(len: number): Promise<void> {
		return this.rpc('truncate', len);
	}

	public truncateSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public write(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<number> {
		return this.rpc('write', buffer, offset, length, position);
	}

	public writeSync(): number {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public read<TBuffer extends Uint8Array>(buffer: TBuffer, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: TBuffer }> {
		return <Promise<{ bytesRead: number; buffer: TBuffer }>>this.rpc('read', buffer, offset, length, position);
	}

	public readSync(): number {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public chown(uid: number, gid: number): Promise<void> {
		return this.rpc('chown', uid, gid);
	}

	public chownSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public chmod(mode: number): Promise<void> {
		return this.rpc('chmod', mode);
	}

	public chmodSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public utimes(atime: Date, mtime: Date): Promise<void> {
		return this.rpc('utimes', atime, mtime);
	}

	public utimesSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public _setType(type: FileType): Promise<void> {
		return this.rpc('_setType', type);
	}

	public _setTypeSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public close(): Promise<void> {
		return this.rpc('close');
	}

	public closeSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public sync(): Promise<void> {
		return this.rpc('sync');
	}

	public syncSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
}
