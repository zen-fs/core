import { ApiError, ErrorCode } from '@zenfs/core/ApiError.js';
import type { Backend } from '@zenfs/core/backends/backend.js';
import { WorkerFS, type WorkerFSOptions } from './fs.js';

/**
 * @hidden
 */
declare const importScripts: (...path: string[]) => unknown;

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

	create(options: WorkerFSOptions) {
		return new WorkerFS(options);
	},
};
