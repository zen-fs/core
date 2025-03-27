/* node:coverage disable */

import { warn } from 'kerium/log';

// eslint-disable-next-line @typescript-eslint/unbound-method
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

/* node:coverage enable */
