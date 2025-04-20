import { Buffer } from 'node:buffer';
import type { BufferEncodingOption, ObjectEncodingOptions } from 'node:fs';
import { pick } from 'utilium';
import type { V_Context } from '../context.js';
import { Errno, ErrnoError } from '../internal/error.js';
import { Attributes, hasAccess } from '../internal/inode.js';
import { normalizePath } from '../utils.js';
import { checkAccess } from './config.js';
import { R_OK, W_OK } from './constants.js';
import { fixError, resolveMount } from './shared.js';

/**
 * Extended attribute name with namespace prefix.
 * Format is namespace.attributename where namespace is one of:
 * - user: User attributes
 * - trusted: Trusted attributes (privileged)
 * - system: System attributes
 * - security: Security attributes
 *
 * Note: Currently only the 'user' namespace is supported.
 */
export type Name = `${'user' | 'trusted' | 'system' | 'security'}.${string}`;

/**
 * Options for xattr operations.
 */
export interface Options {
	/**
	 * If true, don't follow symlinks.
	 * @default false
	 */
	noFollow?: boolean;

	/**
	 * Encoding for attribute values.
	 * If 'buffer' or undefined, the value is returned as a Buffer.
	 * Otherwise, the value is returned as a string using the specified encoding.
	 * @default undefined
	 */
	encoding?: BufferEncoding | 'buffer';
}

/**
 * Options for setting extended attributes.
 * Extends the base Options with additional flags for create/replace behavior.
 */
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

const _allowedRestrictedNames: Name[] = [];

/**
 * Check permission for the attribute name.
 * For now, only attributes in the 'user' namespace are supported.
 * @throws EPERM for attributes in namespaces other than 'user'
 */
function checkName($: V_Context, name: Name, path: string, syscall: string): void {
	if (!name.startsWith('user.') && !_allowedRestrictedNames.includes(name))
		throw new ErrnoError(Errno.EPERM, 'Only attributes in the user namespace are supported', path, syscall);
}

/**
 * Gets the value of an extended attribute.
 *
 * @param path Path to the file
 * @param name Name of the attribute to get
 * @param opt Options for the operation
 * @returns A buffer containing the attribute value when encoding is 'buffer' or undefined, or a string when a string encoding is specified
 */
export async function get(
	this: V_Context,
	path: string,
	name: Name,
	opt?: Options & (BufferEncodingOption | { encoding?: null })
): Promise<Uint8Array>;
export async function get(this: V_Context, path: string, name: Name, opt: Options & ObjectEncodingOptions): Promise<string>;
export async function get(this: V_Context, path: string, name: Name, opt: Options = {}): Promise<string | Uint8Array> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);
	checkName(this, name, path, 'xattr.get');

	try {
		const inode = await fs.stat(resolved);

		if (checkAccess && !hasAccess(this, inode, R_OK)) {
			throw ErrnoError.With('EACCES', resolved, 'xattr.get');
		}

		inode.attributes ??= new Attributes();

		const attr = inode.attributes.get(name);
		if (!attr) throw ErrnoError.With('ENODATA', resolved, 'xattr.get');

		const buffer = Buffer.from(attr.value);

		return opt.encoding == 'buffer' || !opt.encoding ? buffer : buffer.toString(opt.encoding);
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

/**
 * Synchronously gets the value of an extended attribute.
 *
 * @param path Path to the file
 * @param name Name of the attribute to get
 * @param opt Options for the operation
 * @returns A buffer containing the attribute value when encoding is 'buffer' or undefined, or a string when a string encoding is specified
 */
export function getSync(this: V_Context, path: string, name: Name, opt?: Options & (BufferEncodingOption | { encoding?: null })): Uint8Array;
export function getSync(this: V_Context, path: string, name: Name, opt: Options & ObjectEncodingOptions): string;
export function getSync(this: V_Context, path: string, name: Name, opt: Options = {}): string | Uint8Array {
	path = normalizePath(path);
	checkName(this, name, path, 'xattr.get');
	const { fs, path: resolved } = resolveMount(path, this);

	try {
		const inode = fs.statSync(resolved);

		if (checkAccess && !hasAccess(this, inode, R_OK)) {
			throw ErrnoError.With('EACCES', resolved, 'xattr.get');
		}

		inode.attributes ??= new Attributes();

		const attr = inode.attributes.get(name);
		if (!attr) throw ErrnoError.With('ENODATA', resolved, 'xattr.get');

		const buffer = Buffer.from(attr.value);

		return opt.encoding == 'buffer' || !opt.encoding ? buffer : buffer.toString(opt.encoding);
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

/**
 * Sets the value of an extended attribute.
 *
 * @param path Path to the file
 * @param name Name of the attribute to set
 * @param value Value to set
 * @param opt Options for the operation
 */
export async function set(this: V_Context, path: string, name: Name, value: string | Uint8Array, opt: SetOptions = {}): Promise<void> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);

	checkName(this, name, path, 'xattr.set');
	try {
		const inode = await fs.stat(resolved);

		if (checkAccess && !hasAccess(this, inode, W_OK)) {
			throw ErrnoError.With('EACCES', resolved, 'xattr.set');
		}

		inode.attributes ??= new Attributes();

		const attr = inode.attributes.get(name);

		if (opt.create && attr) {
			throw ErrnoError.With('EEXIST', resolved, 'xattr.set');
		}

		if (opt.replace && !attr) {
			throw ErrnoError.With('ENODATA', resolved, 'xattr.set');
		}

		inode.attributes.set(name, Buffer.from(value));

		await fs.touch(resolved, pick(inode, 'attributes'));
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

/**
 * Synchronously sets the value of an extended attribute.
 *
 * @param path Path to the file
 * @param name Name of the attribute to set
 * @param value Value to set
 * @param opt Options for the operation
 */
export function setSync(this: V_Context, path: string, name: Name, value: string | Uint8Array, opt: SetOptions = {}): void {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);

	checkName(this, name, path, 'xattr.set');

	try {
		const inode = fs.statSync(resolved);

		if (checkAccess && !hasAccess(this, inode, W_OK)) {
			throw ErrnoError.With('EACCES', resolved, 'xattr.set');
		}

		inode.attributes ??= new Attributes();

		const attr = inode.attributes.get(name);

		if (opt.create && attr) {
			throw ErrnoError.With('EEXIST', resolved, 'xattr.set');
		}

		if (opt.replace && !attr) {
			throw ErrnoError.With('ENODATA', resolved, 'xattr.set');
		}

		inode.attributes.set(name, Buffer.from(value));

		fs.touchSync(resolved, pick(inode, 'attributes'));
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

/**
 * Removes an extended attribute from a file.
 *
 * @param path Path to the file
 * @param name Name of the attribute to remove
 */
export async function remove(this: V_Context, path: string, name: Name): Promise<void> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);
	checkName(this, name, path, 'xattr.remove');

	try {
		const inode = await fs.stat(resolved);

		if (checkAccess && !hasAccess(this, inode, W_OK)) {
			throw ErrnoError.With('EACCES', resolved, 'xattr.remove');
		}

		inode.attributes ??= new Attributes();

		const attr = inode.attributes.get(name);
		if (!attr) throw ErrnoError.With('ENODATA', resolved, 'xattr.remove');

		inode.attributes.remove(name);

		await fs.touch(resolved, pick(inode, 'attributes'));
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

/**
 * Synchronously removes an extended attribute from a file.
 *
 * @param path Path to the file
 * @param name Name of the attribute to remove
 */
export function removeSync(this: V_Context, path: string, name: Name): void {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);
	checkName(this, name, path, 'xattr.remove');

	try {
		const inode = fs.statSync(resolved);

		if (checkAccess && !hasAccess(this, inode, W_OK)) {
			throw ErrnoError.With('EACCES', resolved, 'xattr.remove');
		}

		inode.attributes ??= new Attributes();

		const attr = inode.attributes.get(name);
		if (!attr) throw ErrnoError.With('ENODATA', resolved, 'xattr.remove');

		inode.attributes.remove(name);

		fs.touchSync(resolved, pick(inode, 'attributes'));
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

/**
 * Lists all extended attributes of a file.
 *
 * @param path Path to the file
 * @returns Array of attribute names
 */
export async function list(this: V_Context, path: string): Promise<Name[]> {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);

	try {
		const inode = await fs.stat(resolved);

		if (!inode.attributes) return [];

		return inode.attributes.keys() as Name[];
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}

/**
 * Synchronously lists all extended attributes of a file.
 *
 * @param path Path to the file
 * @returns Array of attribute names
 */
export function listSync(this: V_Context, path: string): Name[] {
	path = normalizePath(path);
	const { fs, path: resolved } = resolveMount(path, this);

	try {
		const inode = fs.statSync(resolved);

		if (!inode.attributes) return [];

		return inode.attributes.keys() as Name[];
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}
}
