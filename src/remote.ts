import type { FileSystem } from '@zenfs/core/filesystem.js';
import type { Worker as NodeWorker } from 'worker_threads';
import type { RPCRequest } from './rpc.js';

export interface Remote {
	worker: Worker | NodeWorker;
	fs: FileSystem;
}

function messageHandler({ worker, fs }: Remote) {
	return function handleMessage(event: MessageEvent<RPCRequest>): void {
		const { method, args, id } = event.data;

		worker.postMessage({
			_zenfs: true,
			id,
			method,
			// @ts-expect-error 2556
			value: fs[method](...args),
		});
	};
}

export function attach(worker: Worker | NodeWorker, fs: FileSystem): void {
	worker['on' in worker ? 'on' : 'addEventListener'](messageHandler({ worker, fs }));
}

export function detach(worker: Worker | NodeWorker, fs: FileSystem): void {
	worker['off' in worker ? 'off' : 'removeEventListener'](messageHandler({ worker, fs }));
}
