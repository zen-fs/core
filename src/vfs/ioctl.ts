// SPDX-License-Identifier: LGPL-3.0-or-later
/*
	ioctl stuff. The majority of the code here is ported from Linux
	See:
	- include/uapi/asm-generic/ioctl.h
	- include/uapi/linux/fs.h (`FS_IOC_*`)
*/

import { Errno, Exception, setUVMessage, UV } from 'kerium';
import { sizeof } from 'memium';
import { $from, struct, types as t } from 'memium/decorators';
import { _throw } from 'utilium';
import { BufferView } from 'utilium/buffer.js';
import type { V_Context } from '../internal/contexts.js';
import { Inode, InodeFlags } from '../internal/inode.js';
import { normalizePath } from '../utils.js';
import { resolveMount } from './shared.js';

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

@struct('fsxattr')
class fsxattr extends $from(BufferView) {
	/** xflags field value */
	@t.uint32 accessor xflags!: number;
	/** extsize field value */
	@t.uint32 accessor extsize!: number;
	/** nextents field value */
	@t.uint32 accessor nextents!: number;
	/** project identifier */
	@t.uint32 accessor projid!: number;
	/** CoW extsize field value */
	@t.uint32 accessor cowextsize!: number;
	@t.char(8) protected accessor pad: number[] = [];

	public constructor(inode: Inode = _throw(new Exception(Errno.EINVAL, 'fsxattr must be initialized with an inode'))) {
		super(new ArrayBuffer(sizeof(fsxattr)));

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
 * Inode flags (FS_IOC_GETFLAGS / FS_IOC_SETFLAGS)
 * @see `FS_*_FL` in `include/uapi/linux/fs.h` (around L250)
 * @experimental
 */
enum FileFlag {
	/** Secure deletion */
	SecureRm = 0x00000001,
	/** Undelete */
	Undelete = 0x00000002,
	/** Compress file */
	Compress = 0x00000004,
	/** Synchronous updates */
	Sync = 0x00000008,
	/** Immutable file */
	Immutable = 0x00000010,
	/** Writes to file may only append */
	Append = 0x00000020,
	/** do not dump file */
	NoDump = 0x00000040,
	/** do not update atime */
	NoAtime = 0x00000080,
	// Reserved for compression usage...
	Dirty = 0x00000100,
	/** One or more compressed clusters */
	CompressBlk = 0x00000200,
	/** Don't compress */
	NoCompress = 0x00000400,
	// End compression flags --- maybe not all used
	/** Encrypted file */
	Encrypt = 0x00000800,
	/** btree format dir */
	Btree = 0x00001000,
	/** hash-indexed directory */
	// eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
	Index = 0x00001000,
	/** AFS directory */
	IMagic = 0x00002000,
	/** Reserved for ext3 */
	JournalData = 0x00004000,
	/** file tail should not be merged */
	NoTail = 0x00008000,
	/** dirsync behaviour (directories only) */
	DirSync = 0x00010000,
	/** Top of directory hierarchies*/
	TopDir = 0x00020000,
	/** Reserved for ext4 */
	HugeFile = 0x00040000,
	/** Extents */
	Extent = 0x00080000,
	/** Verity protected inode */
	Verity = 0x00100000,
	/** Inode used for large EA */
	EaInode = 0x00200000,
	/** Reserved for ext4 */
	EofBlocks = 0x00400000,
	/** Do not cow file */
	NoCow = 0x00800000,
	/** Inode is DAX */
	Dax = 0x02000000,
	/** Reserved for ext4 */
	InlineData = 0x10000000,
	/** Create with parents projid */
	ProjInherit = 0x20000000,
	/** Folder is case insensitive */
	CaseFold = 0x40000000,
	/** reserved for ext2 lib */
	Reserved = 0x80000000,
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
	path = normalizePath.call(this, path);

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
		throw setUVMessage(Object.assign(e, { syscall: 'ioctl', path }));
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
	path = normalizePath.call(this, path);

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
		throw setUVMessage(Object.assign(e, { syscall: 'ioctl', path }));
	}

	throw UV('ENOTSUP', 'ioctl', path);
}
