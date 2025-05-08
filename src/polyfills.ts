/* node:coverage disable */
/* eslint-disable @typescript-eslint/unbound-method */

import { warn } from 'kerium/log';
import type { UUID } from 'node:crypto';

Promise.withResolvers ??=
	(warn('Using a polyfill of Promise.withResolvers'),
	function <T>(): PromiseWithResolvers<T> {
		let _resolve: ((value: T | PromiseLike<T>) => void) | undefined,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			_reject: ((reason?: any) => void) | undefined;
		const promise = new Promise<T>((resolve, reject) => {
			_resolve = resolve;
			_reject = reject;
		});
		return { promise, resolve: _resolve!, reject: _reject! };
	});

// @ts-expect-error 2540
Symbol['dispose'] ??= (warn('Using a polyfill of Symbol.dispose'), Symbol('Symbol.dispose'));
// @ts-expect-error 2540
Symbol['asyncDispose'] ??= (warn('Using a polyfill of Symbol.asyncDispose'), Symbol('Symbol.asyncDispose'));

function randomUUID(): UUID {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

globalThis.crypto.randomUUID ??= (warn('Using a polyfill of crypto.randomUUID'), randomUUID);

/* node:coverage enable */
