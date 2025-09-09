// SPDX-License-Identifier: LGPL-3.0-or-later
import { Buffer } from 'buffer';
import { rethrow, setUVMessage, UV } from 'kerium';
import type { BufferEncodingOption, ObjectEncodingOptions } from 'node:fs';
import type { V_Context } from '../context.js';
import type { InodeLike } from '../internal/inode.js';
import { Attributes, hasAccess } from '../internal/inode.js';
import { normalizePath } from '../utils.js';
import { checkAccess } from './config.js';
import { R_OK, W_OK } from '../constants.js';
import { resolveMount } from './shared.js';

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
 * @throws ENOTSUP for attributes in namespaces other than 'user'
 */
function checkName($: V_Context, name: Name, path: string, syscall: string): void {
	if (!name.startsWith('user.') && !_allowedRestrictedNames.includes(name)) throw UV('ENOTSUP', syscall, path);
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

	const inode = await fs.stat(resolved).catch(rethrow('xattr.get', path));

	if (checkAccess && !hasAccess(this, inode, R_OK)) throw UV('EACCES', 'xattr.get', path);

	inode.attributes ??= new Attributes();

	const value = inode.attributes.get(name);
	if (!value) throw UV('ENODATA', 'xattr.get', path);

	const buffer = Buffer.from(value);

	return opt.encoding == 'buffer' || !opt.encoding ? buffer : buffer.toString(opt.encoding);
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

	let inode: InodeLike;
	try {
		inode = fs.statSync(resolved);
	} catch (e: any) {
		throw setUVMessage(Object.assign(e, { path }));
	}

	if (checkAccess && !hasAccess(this, inode, R_OK)) throw UV('EACCES', 'xattr.get', path);

	inode.attributes ??= new Attributes();

	const value = inode.attributes.get(name);
	if (!value) throw UV('ENODATA', 'xattr.get', path);

	const buffer = Buffer.from(value);

	return opt.encoding == 'buffer' || !opt.encoding ? buffer : buffer.toString(opt.encoding);
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
	const inode = await fs.stat(resolved).catch(rethrow('xattr.set', path));

	if (checkAccess && !hasAccess(this, inode, W_OK)) throw UV('EACCES', 'xattr.set', path);

	inode.attributes ??= new Attributes();

	const attr = inode.attributes.get(name);

	if (opt.create && attr) throw UV('EEXIST', 'xattr.set', path);

	if (opt.replace && !attr) throw UV('ENODATA', 'xattr.set', path);

	inode.attributes.set(name, Buffer.from(value));

	await fs.touch(resolved, inode).catch(rethrow('xattr.set', path));
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

	let inode: InodeLike;
	try {
		inode = fs.statSync(resolved);
	} catch (e: any) {
		throw setUVMessage(Object.assign(e, { path }));
	}

	if (checkAccess && !hasAccess(this, inode, W_OK)) throw UV('EACCES', 'xattr.set', path);

	inode.attributes ??= new Attributes();

	const attr = inode.attributes.get(name);

	if (opt.create && attr) throw UV('EEXIST', 'xattr.set', path);

	if (opt.replace && !attr) throw UV('ENODATA', 'xattr.set', path);

	inode.attributes.set(name, Buffer.from(value));

	try {
		fs.touchSync(resolved, inode);
	} catch (e: any) {
		throw setUVMessage(Object.assign(e, { path }));
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

	const inode = await fs.stat(resolved).catch(rethrow('xattr.remove', path));

	if (checkAccess && !hasAccess(this, inode, W_OK)) throw UV('EACCES', 'xattr.remove', path);

	inode.attributes ??= new Attributes();

	const attr = inode.attributes.get(name);
	if (!attr) throw UV('ENODATA', 'xattr.remove', path);

	inode.attributes.remove(name);

	await fs.touch(resolved, inode);
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

	let inode: InodeLike;
	try {
		inode = fs.statSync(resolved);
	} catch (e: any) {
		throw setUVMessage(Object.assign(e, { path }));
	}

	if (checkAccess && !hasAccess(this, inode, W_OK)) throw UV('EACCES', 'xattr.remove', path);

	inode.attributes ??= new Attributes();

	const attr = inode.attributes.get(name);
	if (!attr) throw UV('ENODATA', 'xattr.remove', path);

	inode.attributes.remove(name);

	try {
		fs.touchSync(resolved, inode);
	} catch (e: any) {
		throw setUVMessage(Object.assign(e, { path }));
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

	const inode = await fs.stat(resolved).catch(rethrow('xattr.list', path));

	if (!inode.attributes) return [];

	return inode.attributes.keys().toArray() as Name[];
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

	let inode: InodeLike;
	try {
		inode = fs.statSync(resolved);
	} catch (e: any) {
		throw setUVMessage(Object.assign(e, { path }));
	}

	if (!inode.attributes) return [];

	return inode.attributes.keys().toArray() as Name[];
}
