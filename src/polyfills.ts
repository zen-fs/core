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

globalThis.crypto.randomUUID ??=
	(warn('Using a polyfill of crypto.randomUUID'),
	function randomUUID(): UUID {
		const bytes = crypto.getRandomValues(new Uint8Array(16));
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	});

Uint8Array.prototype.toBase64 ??=
	(warn('Using a polyfill of Uint8Array.prototype.toBase64'),
	function toBase64(this: Uint8Array): string {
		return btoa(String.fromCharCode(...this));
	});

Uint8Array.fromBase64 ??=
	(warn('Using a polyfill of Uint8Array.fromBase64'),
	function fromBase64(this: Uint8Array, base64: string): Uint8Array {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes;
	});

Uint8Array.prototype.toHex ??=
	(warn('Using a polyfill of Uint8Array.prototype.toHex'),
	function toHex(this: Uint8Array): string {
		return [...this].map(b => b.toString(16).padStart(2, '0')).join('');
	});

Uint8Array.fromHex ??=
	(warn('Using a polyfill of Uint8Array.fromHex'),
	function fromHex(this: Uint8Array, hex: string): Uint8Array {
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < hex.length; i += 2) {
			bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
		}
		return bytes;
	});

/* node:coverage enable */
