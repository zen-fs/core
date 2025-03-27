/*
	Access Control Lists.
	At the moment, they are only intended for internal use.
	They also are not checked for permissions yet.
	Please use a namespace import for the best experience.
*/
import { Errno } from 'kerium';
import { err } from 'kerium/log';
import { assignWithDefaults, deserialize, serialize, sizeof, struct, types as t } from 'utilium';
import { defaultContext, type V_Context } from '../internal/contexts.js';
import { ErrnoError } from '../internal/error.js';
import { Attributes, type InodeLike } from '../internal/inode.js';
import { R_OK, S_IRWXG, S_IRWXO, S_IRWXU, W_OK, X_OK } from './constants.js';
import * as xattr from './xattr.js';

const version = 2;

export const enum Type {
	Access = 0x8000,
	Default = 0x4000,
}

export const enum Tag {
	UserObj = 0x01,
	User = 0x02,
	GroupObj = 0x04,
	Group = 0x08,
	Mask = 0x10,
	Other = 0x20,

	/**
	 * @internal @hidden
	 */
	_None = 0x00,
}

@struct()
export class Entry {
	@t.uint16 public tag: Tag = 0;
	@t.uint16 public perm: number = 0;
	@t.uint32 public id: number = 0;

	public constructor(data?: Partial<Entry> | Uint8Array) {
		if (data instanceof Uint8Array) deserialize(this, data);
		else if (typeof data == 'object') assignWithDefaults(this as Entry, data);
	}
}

@struct()
export class ACL {
	@t.uint32 public version: number = version;

	public entries: Entry[] = [];

	public constructor(data?: Uint8Array | Entry[]) {
		if (!data) return;

		if (!(data instanceof Uint8Array)) {
			this.entries.push(...data);
			return;
		}

		deserialize(this, data);

		if (this.version != version) throw err(new ErrnoError(Errno.EINVAL, 'Invalid ACL version'));

		for (let offset = sizeof(ACL); offset < data.length; offset += sizeof(Entry)) {
			if (offset + sizeof(Entry) > data.length) throw err(new ErrnoError(Errno.EIO, 'Invalid ACL data'));

			const slice = data.subarray(offset, offset + sizeof(Entry));

			this.entries.push(new Entry(slice));
		}
	}
}

export function fromMode(mode: number): ACL {
	return new ACL([
		new Entry({ tag: Tag.UserObj, perm: (mode & S_IRWXU) >> 6 }),
		new Entry({ tag: Tag.GroupObj, perm: (mode & S_IRWXG) >> 3 }),
		new Entry({ tag: Tag.Other, perm: mode & S_IRWXO }),
	]);
}

export function toMode(acl: ACL): number {
	let mode = 0;

	for (const entry of acl.entries) {
		switch (entry.tag) {
			case Tag.UserObj:
				mode |= entry.perm << 6;
				break;
			case Tag.GroupObj:
				mode |= entry.perm << 3;
				break;
			case Tag.Other:
				mode |= entry.perm;
				break;

			case Tag.User:
			case Tag.Group:
			case Tag.Mask:
			case Tag._None:
				continue;
		}
	}

	return mode;
}

export async function get($: V_Context, path: string): Promise<ACL> {
	return new ACL(await xattr.get.call<V_Context, [string, xattr.Name], Promise<Uint8Array>>($, path, 'system.posix_acl_access'));
}

export function getSync($: V_Context, path: string): ACL {
	return new ACL(xattr.getSync.call<V_Context, [string, xattr.Name], Uint8Array>($, path, 'system.posix_acl_access'));
}

export async function set($: V_Context, path: string, acl: ACL): Promise<void> {
	await xattr.set.call<V_Context, [string, xattr.Name, Uint8Array], Promise<void>>($, path, 'system.posix_acl_access', serialize(acl));
}

export function setSync($: V_Context, path: string, acl: ACL): void {
	xattr.setSync.call<V_Context, [string, xattr.Name, Uint8Array], void>($, path, 'system.posix_acl_access', serialize(acl));
}

export let shouldCheck: boolean = true;

export function setChecks(enabled: boolean): void {
	shouldCheck = enabled;
}

/**
 * Checks if a given user/group has access to this item
 * @param access The requested access, combination of `W_OK`, `R_OK`, and `X_OK`
 */
export function check($: V_Context, inode: InodeLike, access: number): boolean {
	if (!shouldCheck) return true;

	inode.attributes ??= new Attributes();

	const { euid, egid } = $?.credentials ?? defaultContext.credentials;

	const attr = inode.attributes.get('system.posix_acl_access');

	if (!attr) return true;

	const acl = new ACL(attr.value);

	let mask = R_OK | W_OK | X_OK;

	let result = false;

	for (const entry of acl.entries) {
		switch (entry.tag) {
			case Tag.UserObj:
				if (inode.uid == euid && (entry.perm & access) === access) result = true;
				break;
			case Tag.User:
				if (entry.id == euid && (entry.perm & mask & access) === access) result = true;
				break;
			case Tag.GroupObj:
				if (inode.gid == egid && (entry.perm & mask & access) === access) result = true;
				break;
			case Tag.Group:
				if (entry.id == egid && (entry.perm & mask & access) === access) result = true;
				break;
			case Tag.Mask:
				mask = entry.perm;
				break;
			case Tag.Other:
				if ((entry.perm & mask & access) === access) result = true;
				break;
			case Tag._None:
				continue;
		}
	}

	return result;
}
