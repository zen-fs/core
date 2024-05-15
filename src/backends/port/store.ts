/* eslint-disable @typescript-eslint/no-explicit-any */
import { Errno, ErrnoError } from '../../error.js';
import type { Ino } from '../../inode.js';
import { SimpleAsyncStore, StoreFS, type SimpleStore } from '../Store.js';
import type { Backend } from '../backend.js';
import * as RPC from './rpc.js';

interface StoreMethods {
	clear(): void;
	sync(): void;
	get(ino: Ino): Uint8Array | undefined;
	put(ino: bigint, data: Uint8Array, overwrite: boolean): boolean;
	delete(ino: bigint): void;
	entries(): Iterable<[Ino, Uint8Array]>;
}

type StoreMethod = keyof StoreMethods;

type StoreRequest<T extends StoreMethod = StoreMethod> = RPC.Request<'store', T, Parameters<StoreMethods[T]>>;

export class PortStore extends SimpleAsyncStore {
	public readonly isSync = false;
	public readonly port: RPC.Port;
	public constructor(
		public readonly options: RPC.Options,
		public readonly name: string = 'port'
	) {
		super();
		this.port = options.port;
		RPC.attach<RPC.Response>(this.port, RPC.handleResponse);
	}

	protected rpc<const T extends StoreMethod>(method: T, ...args: Parameters<StoreMethods[T]>): Promise<ReturnType<StoreMethods[T]>> {
		return RPC.request<StoreRequest<T>, ReturnType<StoreMethods[T]>>(
			{
				scope: 'store',
				method,
				args,
			},
			this.options
		);
	}

	protected async _entries(): Promise<Iterable<[Ino, Uint8Array]>> {
		return this.rpc('entries');
	}

	public clear(): Promise<void> {
		return this.rpc('clear');
	}

	public async sync(): Promise<void> {
		await super.sync();
		await this.rpc('sync');
	}

	protected _put(ino: bigint, data: Uint8Array, overwrite: boolean): Promise<boolean> {
		return this.rpc('put', ino, data, overwrite);
	}

	protected _delete(ino: bigint): Promise<void> {
		return this.rpc('delete', ino);
	}
}

async function handleRequest(port: RPC.Port, store: SimpleStore, request: StoreRequest): Promise<void> {
	if (!RPC.isMessage(request)) {
		return;
	}
	const { method, args, id, scope, stack } = request;

	let value,
		error: boolean = false;

	if (scope != 'store') {
		return;
	}

	try {
		// @ts-expect-error 2556
		value = await store[method](...args);
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
		value: value instanceof ErrnoError ? value.toJSON() : value,
	});
}

export function attachStore(port: RPC.Port, store: SimpleStore): void {
	RPC.attach(port, (request: StoreRequest) => handleRequest(port, store, request));
}

export function detachStore(port: RPC.Port, store: SimpleStore): void {
	RPC.detach(port, (request: StoreRequest) => handleRequest(port, store, request));
}

export const PortStoreBackend: Backend = {
	name: 'PortStore',

	options: {
		port: {
			type: 'object',
			description: 'The target port that you want to connect to',
			validator(port: RPC.Port) {
				// Check for a `postMessage` function.
				if (typeof port?.postMessage != 'function') {
					throw new ErrnoError(Errno.EINVAL, 'option must be a port.');
				}
			},
		},
	},

	async isAvailable(): Promise<boolean> {
		if ('WorkerGlobalScope' in globalThis && globalThis instanceof (globalThis as typeof globalThis & { WorkerGlobalScope: any }).WorkerGlobalScope) {
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

	create(options: RPC.Options & { name?: string }) {
		return new StoreFS({ ...options, store: new PortStore(options, options?.name) });
	},
};
