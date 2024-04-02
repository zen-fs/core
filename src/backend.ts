import { ApiError, ErrorCode } from '@zenfs/core/ApiError.js';
import type { Backend } from '@zenfs/core/backends/backend.js';
import { PortFS, type PortFSOptions } from './fs.js';
import type { Port as RPCPort } from './rpc.js';

export const Port: Backend = {
	name: 'Port',

	options: {
		port: {
			type: 'object',
			description: 'The target port that you want to connect to',
			validator(port: RPCPort) {
				// Check for a `postMessage` function.
				if (typeof port?.postMessage != 'function') {
					throw new ApiError(ErrorCode.EINVAL, 'option must be a port.');
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

	create(options: PortFSOptions) {
		return new PortFS(options);
	},
};
