// SPDX-License-Identifier: LGPL-3.0-or-later
/*
	ioctl stuff. The majority of the code here is ported from Linux
	See:
	- include/uapi/asm-generic/ioctl.h
	- include/uapi/linux/fs.h (`FS_IOC_*`)
*/

import { setUVMessage, UV } from 'kerium';
import type { PathOrFileDescriptor } from 'node:fs';
import type { V_Context } from '../context.js';
import type { IoctlArgs, IoctlContext, IoctlDefaultAsyncOps, IoctlDefaultSyncOps, IoctlOps } from '../internal/ioctl.js';
import { normalizePath } from '../utils.js';
import { resolve as resolveAsync } from './async.js';
import { fromFD, type Handle } from './file.js';
import { resolve as resolveSync } from './sync.js';
import { cacheOf, type VCache } from './vcache.js';
import type { VNode } from './vnode.js';

/**
 * Perform an `ioctl` on a file or file system.
 * @category ioctl
 */
export async function ioctl<const Command extends number, const Ops extends IoctlOps = IoctlDefaultAsyncOps>(
	this: V_Context,
	path: PathOrFileDescriptor,
	command: Command,
	...args: IoctlArgs<Ops[Command]>
): Promise<ReturnType<Ops[Command]>> {
	let vcache: VCache, vnode: VNode, file: Handle | undefined;

	if (typeof path == 'number') {
		file = fromFD(this, path);
		vcache = cacheOf(file.fs);
		vnode = file.vnode;
		// In the future we may need to use `vcache.ref(...)`
		// For now this avoids some issues: touching vnode.paths, triggering the "referenced by more paths" error, and inode assignment
		vnode.refs++;
	} else {
		path = normalizePath(path);
		const mnt = await resolveAsync(this, path, false, { syscall: 'ioctl', path });
		if (!mnt.stats) throw UV('ENOENT', { syscall: 'ioctl', path });
		vcache = cacheOf(mnt.fs);
		vnode = vcache.ref(mnt.path, vcache.get(mnt.path)?.inode ?? mnt.stats);
	}

	const context: IoctlContext = {
		fs: vnode.fs,
		inode: vnode.inode,
		path: vnode.path,
		file,
	};

	try {
		return await vnode.fs.ioctl(context, command, ...args);
	} catch (e: any) {
		throw setUVMessage(Object.assign(e, { syscall: 'ioctl', path }));
	} finally {
		vcache.unref(vnode);
	}
}

/**
 * Perform an `ioctl` on a file or file system
 * @category ioctl
 */
export function ioctlSync<const Command extends number, const Ops extends IoctlOps = IoctlDefaultSyncOps>(
	this: V_Context,
	path: PathOrFileDescriptor,
	command: Command,
	...args: IoctlArgs<Ops[Command]>
): ReturnType<Ops[Command]> {
	let vcache: VCache, vnode: VNode, file: Handle | undefined;

	if (typeof path == 'number') {
		file = fromFD(this, path);
		vcache = cacheOf(file.fs);
		vnode = file.vnode;
		// In the future we may need to use `vcache.ref(...)`
		// For now this avoids some issues: touching vnode.paths, triggering the "referenced by more paths" error, and inode assignment
		vnode.refs++;
	} else {
		path = normalizePath(path);
		const mnt = resolveSync(this, path, false, { syscall: 'ioctl', path });
		if (!mnt.stats) throw UV('ENOENT', { syscall: 'ioctl', path });
		vcache = cacheOf(mnt.fs);
		vnode = vcache.ref(mnt.path, vcache.get(mnt.path)?.inode ?? mnt.stats);
	}

	const context: IoctlContext = {
		fs: vnode.fs,
		inode: vnode.inode,
		path: vnode.path,
		file,
	};

	try {
		return vnode.fs.ioctlSync(context, command, ...args);
	} catch (e: any) {
		throw setUVMessage(Object.assign(e, { syscall: 'ioctl', path }));
	} finally {
		vcache.unref(vnode);
	}
}
