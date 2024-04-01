import { ApiError, ErrorCode } from '@zenfs/core/ApiError.js';
import type { Backend } from '@zenfs/core/backends/backend.js';
import { WorkerFS, type WorkerFSOptions } from './fs.js';
import type { RPCWorker } from './rpc.js';

export const Worker: Backend = {
	name: 'WorkerFS',

	options: {
		worker: {
			type: 'object',
			description: 'The target worker that you want to connect to, or the current worker if in a worker context.',
			validator(worker: RPCWorker) {
				// Check for a `postMessage` function.
				if (typeof worker?.postMessage != 'function') {
					throw new ApiError(ErrorCode.EINVAL, 'option must be a worker instance.');
				}
			},
		},
	},

	async isAvailable(): Promise<boolean> {
		if ('WorkerGlobalScope' in globalThis && globalThis instanceof globalThis.WorkerGlobalScope) {
			// Web Worker
			return true;
		}

		try {
			const worker_threads = await import('node:worker_threads');

			// NodeJS worker
			return 'Worker' in worker_threads;
		} catch (e) {
			return false;
		}
	},

	create(options: WorkerFSOptions) {
		return new WorkerFS(options);
	},
};
