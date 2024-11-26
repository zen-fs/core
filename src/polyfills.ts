// eslint-disable-next-line @typescript-eslint/unbound-method
Promise.withResolvers ??= function <T>(): PromiseWithResolvers<T> {
	let _resolve: ((value: T | PromiseLike<T>) => void) | undefined,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		_reject: ((reason?: any) => void) | undefined;
	const promise = new Promise<T>((resolve, reject) => {
		_resolve = resolve;
		_reject = reject;
	});
	return { promise, resolve: _resolve!, reject: _reject! };
};

// @ts-expect-error 2540
Symbol['dispose'] ??= Symbol('Symbol.dispose');
// @ts-expect-error 2540
Symbol['asyncDispose'] ??= Symbol('Symbol.asyncDispose');
