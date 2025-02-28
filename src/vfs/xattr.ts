import { Buffer } from 'buffer';
import type { BufferEncodingOption, ObjectEncodingOptions } from 'node:fs';
import type { V_Context } from '../context.js';
import { Errno, ErrnoError } from '../internal/error.js';
import { normalizePath } from '../utils.js';
import { fixError, resolveMount } from './shared.js';

export type Name = `${'user' | 'trusted' | 'system' | 'security'}.${string}`;

export interface Options {
	/**
	 * If true, don't follow symlinks.
	 * @default false
	 */
	noFollow?: boolean;

	/** Encoding */
	encoding?: BufferEncoding | 'buffer';
}

export interface SetOptions extends Options {
	/**
	 * If true, fail if the attribute already exists.
	 * @default false
	 */
	create?: boolean;

	/**
	 * If true, fail if the attribute does not exist.
	 * @default false
	 */
	replace?: boolean;
}

/**
 * Check permission for the attribute name.
 * For now, only attributes in the 'user' namespace are supported.
 * @throws EPERM for attributes in namespaces other than 'user'
 */
function checkName($: V_Context, name: Name, path: string, syscall: string): void {
	if (!name.startsWith('user.')) throw new ErrnoError(Errno.EPERM, 'Only attributes in the user namespace are supported', path, syscall);
}

export async function get(
	this: V_Context,
	path: string,
	name: Name,
	opt: Options & (BufferEncodingOption | { encoding?: null })
): Promise<Uint8Array>;
export async function get(this: V_Context, path: string, name: Name, opt: Options & ObjectEncodingOptions): Promise<string>;
export async function get(this: V_Context, path: string, name: Name, opt: Options = {}): Promise<string | Uint8Array> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);
	checkName(this, name, path, 'xattr.get');

	try {
		const inode = await fs.stat(resolved);

		inode.attributes ||= {};

		if (!(name in inode.attributes)) {
			throw ErrnoError.With('ENODATA', resolved, 'xattr.get');
		}

		const value = inode.attributes[name];

		const buffer = Buffer.from(value);
		return opt.encoding == 'buffer' || !opt.encoding ? buffer : buffer.toString(opt.encoding);
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

export function getSync(this: V_Context, path: string, name: Name, opt: Options & (BufferEncodingOption | { encoding?: null })): Uint8Array;
export function getSync(this: V_Context, path: string, name: Name, opt: Options & ObjectEncodingOptions): string;
export function getSync(this: V_Context, path: string, name: Name, opt: Options = {}): string | Uint8Array {
	path = normalizePath(path);
	checkName(this, name, path, 'xattr.get');
	const { fs, path: resolved } = resolveMount(path, this);

	try {
		const inode = fs.statSync(resolved);

		inode.attributes ||= {};

		if (!(name in inode.attributes)) {
			throw ErrnoError.With('ENODATA', resolved, 'xattr.get');
		}

		const value = inode.attributes[name];

		const buffer = Buffer.from(value);

		return opt.encoding == 'buffer' || !opt.encoding ? buffer : buffer.toString(opt.encoding);
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

export async function set(this: V_Context, path: string, name: Name, value: string | Uint8Array, opt: SetOptions = {}): Promise<void> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);

	checkName(this, name, path, 'xattr.set');
	try {
		const inode = await fs.stat(resolved);

		inode.attributes ||= {};

		if (opt.create && name in inode.attributes) {
			throw ErrnoError.With('EEXIST', resolved, 'xattr.set');
		}

		if (opt.replace && !(name in inode.attributes)) {
			throw ErrnoError.With('ENODATA', resolved, 'xattr.set');
		}

		const attributes = { ...inode.attributes, [name]: Buffer.from(value).toString('utf8') };

		await fs.touch(resolved, { attributes });
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

export function setSync(this: V_Context, path: string, name: Name, value: string | Uint8Array, opt: SetOptions = {}): void {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);

	checkName(this, name, path, 'xattr.set');

	try {
		const inode = fs.statSync(resolved);

		inode.attributes ||= {};

		if (opt.create && name in inode.attributes) {
			throw ErrnoError.With('EEXIST', resolved, 'xattr.set');
		}

		if (opt.replace && !(name in inode.attributes)) {
			throw ErrnoError.With('ENODATA', resolved, 'xattr.set');
		}

		const attributes = { ...inode.attributes, [name]: Buffer.from(value).toString('utf8') };

		fs.touchSync(resolved, { attributes });
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

export async function remove(this: V_Context, path: string, name: Name): Promise<void> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);
	checkName(this, name, path, 'xattr.remove');

	try {
		const inode = await fs.stat(resolved);

		if (!inode.attributes || !(name in inode.attributes)) {
			throw ErrnoError.With('ENODATA', resolved, 'xattr.remove');
		}

		const attributes = { ...inode.attributes };
		delete attributes[name];

		await fs.touch(resolved, { attributes });
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

export function removeSync(this: V_Context, path: string, name: Name): void {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);
	checkName(this, name, path, 'xattr.remove');

	try {
		const inode = fs.statSync(resolved);

		if (!inode.attributes || !(name in inode.attributes)) {
			throw ErrnoError.With('ENODATA', resolved, 'xattr.remove');
		}

		const attributes = { ...inode.attributes };
		delete attributes[name];

		fs.touchSync(resolved, { attributes });
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

export async function list(this: V_Context, path: string): Promise<Name[]> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);

	try {
		const inode = await fs.stat(resolved);

		if (!inode.attributes) return [];

		return Object.keys(inode.attributes) as Name[];
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

export function listSync(this: V_Context, path: string): Name[] {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);

	try {
		const inode = fs.statSync(resolved);

		if (!inode.attributes) return [];

		return Object.keys(inode.attributes) as Name[];
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}
