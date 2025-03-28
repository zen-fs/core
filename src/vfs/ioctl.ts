/*
	ioctl stuff. The majority of the code here is ported from Linux
	See:
	- include/uapi/asm-generic/ioctl.h
	- include/uapi/linux/fs.h (`FS_IOC_*`)
*/

import { UV, withErrno } from 'kerium';
import { _throw, struct, types as t } from 'utilium';
import type { V_Context } from '../context.js';
import { Inode, InodeFlags } from '../internal/inode.js';
import { normalizePath } from '../utils.js';
import { fixError, resolveMount } from './shared.js';

/*
 * Flags for the fsxattr.xflags field
 */
enum XFlag {
	/** data in realtime volume */
	RealTime = 0x00000001,
	/** preallocated file extents */
	PreAlloc = 0x00000002,
	/** file cannot be modified */
	Immutable = 0x00000008,
	/** all writes append */
	Append = 0x00000010,
	/** all writes synchronous */
	Sync = 0x00000020,
	/** do not update access time */
	NoAtime = 0x00000040,
	/** do not include in backups */
	NoDump = 0x00000080,
	/** create with rt bit set */
	RtInherit = 0x00000100,
	/** create with parents projid */
	ProjInherit = 0x00000200,
	/** disallow symlink creation */
	NoSymlinks = 0x00000400,
	/** extent size allocator hint */
	ExtSize = 0x00000800,
	/** inherit inode extent size */
	ExtSzInherit = 0x00001000,
	/** do not defragment */
	NoDefrag = 0x00002000,
	/** use filestream allocator */
	FileStream = 0x00004000,
	/** use DAX for IO */
	Dax = 0x00008000,
	/** CoW extent size allocator hint */
	CowExtSize = 0x00010000,
	/** no DIFLAG for this */
	HasAttr = 0x80000000,
}

@struct()
class fsxattr {
	/** xflags field value */
	@t.uint32 public xflags: number = 0;
	/** extsize field value */
	@t.uint32 public extsize: number = 0;
	/** nextents field value */
	@t.uint32 public nextents: number = 0;
	/** project identifier */
	@t.uint32 public projid: number = 0;
	/** CoW extsize field value */
	@t.uint32 public cowextsize: number = 0;
	@t.char(8) protected pad = [];

	public constructor(inode: Inode = _throw(withErrno('EINVAL', 'fsxattr must be initialized with an inode'))) {
		this.extsize = inode.size;
		this.nextents = 1;
		this.projid = inode.uid;
		this.cowextsize = inode.size;

		for (const name of Object.keys(InodeFlags) as (keyof typeof InodeFlags)[]) {
			if (!(inode.flags & InodeFlags[name])) continue;
			if (name in XFlag) this.xflags |= XFlag[name as keyof typeof XFlag];
		}
	}
}

/**
 * `FS_IOC_*` commands for {@link ioctl | `ioctl`}
 * @remarks
 * These are computed from a script since constant values are needed for enum member types
 */
export enum IOC {
	GetFlags = 0x80086601,
	SetFlags = 0x40086602,
	GetVersion = 0x80087601,
	SetVersion = 0x40087602,
	Fiemap = 0xc020660b,
	GetXattr = 0x801c581f,
	SetXattr = 0x401c5820,
	GetLabel = 0x81009431,
	SetLabel = 0x41009432,
	GetUUID = 0x80111500,
	GetSysfsPath = 0x80811501,
}

/**
 * `FS_IOC32_*` commands for {@link ioctl | `ioctl`}
 * @remarks
 * These are computed from a script since constant values are needed for enum member types
 */
export enum IOC32 {
	GetFlags = 0x80046601,
	SetFlags = 0x40046602,
	GetVersion = 0x80047601,
	SetVersion = 0x40047602,
}

/** Used by `ioctl` for type inference */
interface _ioc_ops {
	[IOC.GetFlags](): number;
	[IOC.SetFlags](flags: number): void;
	[IOC.GetVersion](): number;
	[IOC.SetVersion](version: number): void;
	[IOC.Fiemap](): never;
	[IOC.GetXattr](name: string): fsxattr;
	[IOC.SetXattr](name: string, value: fsxattr): never;
	[IOC.GetLabel](): string;
	[IOC.SetLabel](label: string): void;
	[IOC.GetUUID](): string;
	[IOC.GetSysfsPath](): string;
}

/** Used by `ioctl` for type inference */
interface _ioc32_ops extends Record<keyof IOC32, (...args: any[]) => any> {
	[IOC32.GetFlags](): number;
	[IOC32.SetFlags](flags: number): void;
	[IOC32.GetVersion](): number;
	[IOC32.SetVersion](version: number): void;
}

/** Used by `ioctl` for type inference */
type __ioctl_args__<T extends number> = T extends IOC ? Parameters<_ioc_ops[T]> : T extends IOC32 ? Parameters<_ioc32_ops[T]> : any[];

/** Used by `ioctl` for type inference */
type __ioctl_return__<T extends number> = T extends IOC ? ReturnType<_ioc_ops[T]> : T extends IOC32 ? ReturnType<_ioc32_ops[T]> : any;

/** Perform an `ioctl` on a file or file system. */
export async function ioctl<const Command extends number, const Args extends __ioctl_args__<Command>, const Return extends __ioctl_return__<Command>>(
	this: V_Context,
	/** The path to the file or file system to perform the `ioctl` on */
	path: string,
	/** The command to perform (uint32) */
	command: Command,
	/** The arguments to pass to the command */
	...args: Args
): Promise<Return> {
	path = normalizePath(path);

	const { fs, path: resolved } = resolveMount(path, this);

	type _rt = Return;
	type _args<C extends number> = __ioctl_args__<C>;

	try {
		const inode = new Inode(await fs.stat(resolved));

		switch (command) {
			case IOC.GetFlags:
			case IOC32.GetFlags:
				return inode.flags as _rt;
			case IOC.SetFlags:
			case IOC32.SetFlags:
				inode.flags = (args as _args<IOC.SetFlags>)[0];
				await fs.touch(resolved, inode);
				return undefined as _rt;
			case IOC.GetVersion:
			case IOC32.GetVersion:
				return inode.version as _rt;
			case IOC.SetVersion:
			case IOC32.SetVersion:
				inode.version = (args as _args<IOC.SetVersion>)[0];
				await fs.touch(resolved, inode);
				return undefined as _rt;
			case IOC.Fiemap:
				break;
			case IOC.GetXattr:
				return new fsxattr(inode) as _rt;
			case IOC.SetXattr:
				break;
			case IOC.GetLabel:
				return fs.label as _rt;
			case IOC.SetLabel:
				fs.label = (args as _args<IOC.SetLabel>)[0];
				return undefined as _rt;
			case IOC.GetUUID:
				return fs.uuid as _rt;
			case IOC.GetSysfsPath:
				/**
				 * Returns the path component under /sys/fs/ that refers to this filesystem;
				 * also /sys/kernel/debug/ for filesystems with debugfs exports
				 * @todo Implement sysfs and have each FS implement the /sys/fs/<name> tree
				 */
				return `/sys/fs/${fs.name}/${fs.uuid}` as _rt;
		}
	} catch (e: any) {
		throw fixError(e, { [resolved]: path });
	}

	throw UV('ENOTSUP', 'ioctl', path);
}

/** Perform an `ioctl` on a file or file system */
export function ioctlSync<const Command extends number, const Args extends __ioctl_args__<Command>, const Return extends __ioctl_return__<Command>>(
	this: V_Context,
	/** The path to the file or file system to perform the `ioctl` on */
	path: string,
	/** The command to perform (uint32) */
	command: Command,
	/** The arguments to pass to the command */
	...args: Args
): Return {
	path = normalizePath(path);

	const { fs, path: resolved } = resolveMount(path, this);

	type _rt = Return;
	type _args<C extends number> = __ioctl_args__<C>;

	try {
		const inode = new Inode(fs.statSync(resolved));

		switch (command) {
			case IOC.GetFlags:
			case IOC32.GetFlags:
				return inode.flags as _rt;
			case IOC.SetFlags:
			case IOC32.SetFlags:
				inode.flags = (args as _args<IOC.SetFlags>)[0];
				fs.touchSync(resolved, inode);
				return undefined as _rt;
			case IOC.GetVersion:
			case IOC32.GetVersion:
				return inode.version as _rt;
			case IOC.SetVersion:
			case IOC32.SetVersion:
				inode.version = (args as _args<IOC.SetVersion>)[0];
				fs.touchSync(resolved, inode);
				return undefined as _rt;
			case IOC.Fiemap:
				break;
			case IOC.GetXattr:
				return new fsxattr(inode) as _rt;
			case IOC.SetXattr:
				break;
			case IOC.GetLabel:
				return fs.label as _rt;
			case IOC.SetLabel:
				fs.label = (args as _args<IOC.SetLabel>)[0];
				return undefined as _rt;
			case IOC.GetUUID:
				return fs.uuid as _rt;
			case IOC.GetSysfsPath:
				/**
				 * Returns the path component under /sys/fs/ that refers to this filesystem;
				 * also /sys/kernel/debug/ for filesystems with debugfs exports
				 * @todo Implement sysfs and have each FS implement the /sys/fs/<name> tree
				 */
				return `/sys/fs/${fs.name}/${fs.uuid}` as _rt;
		}
	} catch (e: any) {
		throw fixError(e, { [resolved]: path });
	}

	throw UV('ENOTSUP', 'ioctl', path);
}
