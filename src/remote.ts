import type { FileSystem } from '@zenfs/core/filesystem.js';
import type { RPCRequest, RPCWorker } from './rpc.js';

export interface Remote {
	worker: RPCWorker;
	fs: FileSystem;
}

async function handleMessage(worker: RPCWorker, fs: FileSystem, message: MessageEvent<RPCRequest> | RPCRequest): Promise<void> {
	const data = 'data' in message ? message.data : message;
	const { method, args, id } = data;
	let value;

	try {
		// @ts-expect-error 2556
		value = await fs[method](...args);
	} catch (e) {
		value = e;
	}

	worker.postMessage({
		_zenfs: true,
		id,
		method,
		value,
	});
}

export function attach(worker: RPCWorker, fs: FileSystem): void {
	worker['on' in worker ? 'on' : 'addEventListener']('message', (message: any) => handleMessage(worker, fs, message));
}

export function detach(worker: RPCWorker, fs: FileSystem): void {
	worker['off' in worker ? 'off' : 'removeEventListener']('message', event => handleMessage(worker, fs, event));
}
