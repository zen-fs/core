import type { AsyncStore, AsyncStoreOptions, AsyncTransaction, Backend, SyncStore, SyncTransaction } from '@zenfs/core';
import { ApiError, AsyncStoreFS, ErrorCode } from '@zenfs/core';
import * as RPC from './rpc.js';
import type { ExtractProperties } from './utils.js';

export class PortStore implements AsyncStore {
	public readonly port: RPC.Port;
	public constructor(
		public readonly options: RPC.Options,
		public readonly name: string = 'port'
	) {
		this.port = options.port;
		RPC.attach(this.port, RPC.handleResponse);
	}

	public clear(): Promise<void> {
		return RPC.request(
			{
				scope: 'store',
				method: 'clear',
				args: [],
			},
			this.options
		);
	}

	public beginTransaction(): PortTransaction {
		const id = RPC.request<RPC.Request, number>(
			{
				scope: 'store',
				method: 'beginTransaction',
				args: [],
			},
			this.options
		);
		return new PortTransaction(this, id);
	}
}

type TxMethods = ExtractProperties<AsyncTransaction, (...args: unknown[]) => Promise<unknown>>;
type TxMethod = keyof TxMethods;
interface TxRequest<TMethod extends TxMethod = TxMethod> extends RPC.Request<'transaction', TMethod, Parameters<TxMethods[TMethod]>> {
	tx: number;
}

export class PortTransaction implements AsyncTransaction {
	constructor(
		public readonly store: PortStore,
		public readonly id: number | Promise<number>
	) {}

	public async rpc<const T extends TxMethod>(method: T, ...args: Parameters<TxMethods[T]>): Promise<Awaited<ReturnType<TxMethods[T]>>> {
		return RPC.request<TxRequest<T>, Awaited<ReturnType<TxMethods[T]>>>(
			{
				scope: 'transaction',
				tx: await this.id,
				method,
				args,
			},
			this.store.options
		);
	}

	public get(key: bigint): Promise<Uint8Array> {
		return this.rpc('get', key);
	}

	public async put(key: bigint, data: Uint8Array, overwrite: boolean): Promise<boolean> {
		return await this.rpc('put', key, data, overwrite);
	}

	public async remove(key: bigint): Promise<void> {
		return await this.rpc('remove', key);
	}

	public async commit(): Promise<void> {
		return await this.rpc('commit');
	}

	public async abort(): Promise<void> {
		return await this.rpc('abort');
	}
}

let nextTx = 0;

const transactions: Map<number, AsyncTransaction | SyncTransaction> = new Map();

async function handleRequest(port: RPC.Port, store: AsyncStore | SyncStore, request: RPC.Request): Promise<void> {
	if (!RPC.isMessage(request)) {
		return;
	}
	const { method, args, id, scope, stack } = request;

	let value, error: boolean;

	try {
		switch (scope) {
			case 'store':
				value = await store[method](...args);
				if (method == 'beginTransaction') {
					transactions.set(++nextTx, value);
					value = nextTx;
				}
				break;
			case 'transaction':
				const { tx } = <TxRequest>request;
				if (!transactions.has(tx)) {
					throw new ApiError(ErrorCode.EBADF);
				}
				value = await transactions.get(tx)[method](...args);
				if (method == 'close') {
					transactions.delete(tx);
				}
				break;
			default:
				return;
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

export function attachStore(port: RPC.Port, store: SyncStore | AsyncStore): void {
	RPC.attach(port, (request: RPC.Request) => handleRequest(port, store, request));
}

export function detachStore(port: RPC.Port, store: SyncStore | AsyncStore): void {
	RPC.detach(port, (request: RPC.Request) => handleRequest(port, store, request));
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

	create(options: RPC.Options & AsyncStoreOptions & { name?: string }) {
		return new AsyncStoreFS({ ...options, store: new PortStore(options, options?.name) });
	},
};
