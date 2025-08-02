/*
	Access Control Lists.
	At the moment, they are only intended for internal use.
	They also are not checked for permissions yet.
	Please use a namespace import for the best experience.
*/
import { withErrno } from 'kerium';
import { err } from 'kerium/log';
import { packed, sizeof } from 'memium';
import { $from, struct, types as t } from 'memium/decorators';
import { BufferView } from 'utilium/buffer.js';
import { defaultContext, type V_Context } from '../internal/contexts.js';
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

@struct('ACL.Entry', packed)
export class Entry extends $from(BufferView) {
	@t.uint16 accessor tag!: Tag;
	@t.uint16 accessor perm!: number;
	@t.uint32 accessor id!: number;
}

@struct('ACL', packed)
export class ACL extends $from(BufferView) {
	@t.uint32 accessor version!: number;

	public entries: Entry[] = [];

	public constructor(...args: ConstructorParameters<typeof BufferView>) {
		super(...(args as any));

		this.version ||= version;

		if (this.version != version) throw err(withErrno('EINVAL', 'Invalid ACL version'));

		for (let offset = sizeof(ACL); offset < this.byteLength; offset += sizeof(Entry)) {
			if (offset + sizeof(Entry) > this.byteLength) throw err(withErrno('EIO', 'Invalid ACL data'));

			this.entries.push(new Entry(this.buffer, offset));
		}
	}
}

export function fromMode(mode: number): ACL {
	const acl = new ACL();

	acl.entries.push(
		Object.assign(new Entry(), { tag: Tag.UserObj, perm: (mode & S_IRWXU) >> 6 }),
		Object.assign(new Entry(), { tag: Tag.GroupObj, perm: (mode & S_IRWXG) >> 3 }),
		Object.assign(new Entry(), { tag: Tag.Other, perm: mode & S_IRWXO })
	);

	return acl;
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
	await xattr.set.call<V_Context, [string, xattr.Name, Uint8Array], Promise<void>>(
		$,
		path,
		'system.posix_acl_access',
		new Uint8Array(acl.buffer, acl.byteOffset, acl.byteLength)
	);
}

export function setSync($: V_Context, path: string, acl: ACL): void {
	xattr.setSync.call<V_Context, [string, xattr.Name, Uint8Array], void>(
		$,
		path,
		'system.posix_acl_access',
		new Uint8Array(acl.buffer, acl.byteOffset, acl.byteLength)
	);
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

	const data = inode.attributes.get('system.posix_acl_access');

	if (!data) return true;

	const acl = new ACL(data);

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
