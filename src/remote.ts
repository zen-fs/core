import type { FileSystem } from '@zenfs/core/filesystem.js';
import * as RPC from './rpc.js';
import { ApiError, ErrorCode, File } from '@zenfs/core';

let nextFd = 0;

const descriptors: Map<number, File> = new Map();

async function handleMessage(port: RPC.Port, fs: FileSystem, message: MessageEvent<RPC.Request> | RPC.Request): Promise<void> {
	const data = 'data' in message ? message.data : message;
	if (!RPC.isMessage(data)) {
		return;
	}
	const { method, args, id, scope, stack } = data;

	let value, error: boolean;

	try {
		switch (scope) {
			case 'fs':
				// @ts-expect-error 2556
				value = await fs[method](...args);
				if (value instanceof File) {
					descriptors.set(++nextFd, value);
					value = {
						fd: nextFd,
						path: value.path,
						position: value.position,
					};
				}
				break;
			case 'file':
				if (!descriptors.has(data.fd)) {
					throw new ApiError(ErrorCode.EBADF);
				}
				// @ts-expect-error 2556
				value = await descriptors.get(data.fd)[method](...args);
				if (method == 'close') {
					descriptors.delete(data.fd);
				}
				break;
		}
	} catch (e) {
		value = e;
		error = true;
	}

	port.postMessage({
		_zenfs: true,
		scope,
		id,
		error,
		method,
		stack,
		value,
	});
}

export function attach(port: RPC.Port, fs: FileSystem): void {
	port['on' in port ? 'on' : 'addEventListener']('message', (message: MessageEvent<RPC.Request> | RPC.Request) => handleMessage(port, fs, message));
}

export function detach(port: RPC.Port, fs: FileSystem): void {
	port['off' in port ? 'off' : 'removeEventListener']('message', (message: MessageEvent<RPC.Request> | RPC.Request) => handleMessage(port, fs, message));
}
