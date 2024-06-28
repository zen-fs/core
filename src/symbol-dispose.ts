/*
	This file acts as a polyfill for when these symbols are undefined.
	For some reason, NodeJS does not polyfill them in a VM context.
	Since jest uses a VM context for ESM, these need to be here.
*/
// @ts-expect-error 2540
Symbol['dispose'] ??= Symbol('Symbol.dispose');
// @ts-expect-error 2540
Symbol['asyncDispose'] ??= Symbol('Symbol.asyncDispose');
