/*
	ioctl stuff. The majority of the code here is ported from Linux
	See:
	- include/uapi/asm-generic/ioctl.h
	- include/uapi/linux/fs.h (`FS_IOC_*`)
*/

import { sizeof, struct, types as t } from 'utilium';
import type { V_Context } from '../context.js';
import { Errno, ErrnoError } from '../internal/error.js';
import { normalizePath } from '../utils.js';
import { fixError, resolveMount } from './shared.js';
import { Inode, InodeFlags } from '../internal/inode.js';

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

	public constructor(inode: Inode) {
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

const _ionone = 0;
const _iow = 1;
const _ior = 2;
const _iorw = 3;

const _bits_nr = 8;
const _bits_type = 8;
const _bits_size = 14;
const _bits_dir = 2;

const _mask_nr = 1 << (_bits_nr - 1);
const _mask_type = 1 << (_bits_type - 1);
const _mask_size = 1 << (_bits_size - 1);
const _mask_dir = 1 << (_bits_dir - 1);

const _shift_nr = 0;
const _shift_type = _shift_nr + _bits_nr;
const _shift_size = _shift_type + _bits_type;
const _shift_dir = _shift_size + _bits_size;

function _encode(dir: number, type: number, nr: number, size: number): number {
	const value = (dir << _shift_dir) | (type << _shift_type) | (nr << _shift_nr) | (size << _shift_size);
	return value < 0 ? 1 + ~value : value; // Why doesn't JS have unsigned left shift?!
}

function _decode(value: number): [dir: number, type: number, nr: number, size: number] {
	return [
		(value >> _shift_dir) & _mask_dir,
		(value >> _shift_type) & _mask_type,
		(value >> _shift_nr) & _mask_nr,
		(value >> _shift_size) & _mask_size,
	];
}

const _f = 0x66;
const _v = 0x76;
const _X = 0x58;

// Precomputed since it doesn't make sense to implement just for the size
const _sz_fiemap = 32;
const _sz_fsuuid2 = 17;
const _sz_fs_sysfs_path = 129;

/**
 * @todo Use this vs a string for the command?
 */
enum IOC {
	GetFlags = _encode(_ior, _f, 1, 8),
	SetFlags = _encode(_iow, _f, 2, 8),
	GetVersion = _encode(_ior, _v, 1, 8),
	SetVersion = _encode(_iow, _v, 2, 8),
	Fiemap = _encode(_iorw, _f, 11, _sz_fiemap),
	GetXattr = _encode(_ior, _X, 31, sizeof(fsxattr)),
	SetXattr = _encode(_iow, _X, 32, sizeof(fsxattr)),
	GetLabel = _encode(_ior, 0x94, 49, 256),
	SetLabel = _encode(_iow, 0x94, 50, 256),
	GetUuid = _encode(_ior, 0x15, 0, _sz_fsuuid2),
	/*
	 * Returns the path component under /sys/fs/ that refers to this filesystem;
	 * also /sys/kernel/debug/ for filesystems with debugfs exports
	 */
	GetSysfsPath = _encode(_ior, 0x15, 1, _sz_fs_sysfs_path),
}

enum IOC32 {
	GetFlags = _encode(_ior, _f, 1, 4),
	SetFlags = _encode(_iow, _f, 2, 4),
	GetVersion = _encode(_ior, _v, 1, 4),
	SetVersion = _encode(_iow, _v, 2, 4),
}

/**
 * Used by `ioctl` for type inference
 * @internal @hidden
 * @category Internals
 */
export interface _ioctl_ops {
	IOC_GETFLAGS(): void;
	IOC_SETFLAGS(flags: number): void;
	IOC_GETVERSION(): void;
	IOC_SETVERSION(version: number): void;
	IOC_FIEMAP(): never;
	IOC_GETXATTR(name: string): fsxattr;
	IOC_SETXATTR(name: string, value: fsxattr): never;
	IOC_GETLABEL(): string;
	IOC_SETLABEL(label: string): void;
	IOC_GETUUID(): string;
	IOC_GETSYSFSPATH(): string;
}

/**
 * @todo enum vs string for command?
 */
export async function ioctl<const T extends keyof _ioctl_ops>(
	this: V_Context,
	path: string,
	command: T,
	...args: Parameters<_ioctl_ops[T]>
): Promise<ReturnType<_ioctl_ops[T]>> {
	path = normalizePath(path);

	const { fs, path: resolved } = resolveMount(path, this);

	type _rt = ReturnType<_ioctl_ops[T]>;

	try {
		const inode = new Inode(await fs.stat(resolved));

		switch (command) {
			case 'IOC_GETFLAGS':
				return inode.flags as _rt;
			case 'IOC_SETFLAGS':
				inode.flags = (args as Parameters<_ioctl_ops['IOC_SETFLAGS']>)[0];
				await fs.touch(resolved, inode);
				return undefined as _rt;
			case 'IOC_GETVERSION':
				return inode.version as _rt;
			case 'IOC_SETVERSION':
				inode.version = (args as Parameters<_ioctl_ops['IOC_SETVERSION']>)[0];
				await fs.touch(resolved, inode);
				return undefined as _rt;
			case 'IOC_FIEMAP':
				break;
			case 'IOC_GETXATTR':
				return new fsxattr(inode) as _rt;
			case 'IOC_SETXATTR':
				break;
			case 'IOC_GETLABEL':
				return fs.label as _rt;
			case 'IOC_SETLABEL':
				fs.label = (args as Parameters<_ioctl_ops['IOC_SETLABEL']>)[0];
				return undefined as _rt;
			case 'IOC_GETUUID':
				return fs.uuid as _rt;
			case 'IOC_GETSYSFSPATH':
				/**
				 * @todo Implement sysfs and have each FS implement the /sys/fs/<name> tree
				 */
				return `/sys/fs/${fs.name}/${fs.uuid}` as _rt;
		}
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}

	throw new ErrnoError(Errno.ENOTSUP, 'Unsupported command: ' + command, path, 'ioctl');
}

export function ioctlSync<const T extends keyof _ioctl_ops>(
	this: V_Context,
	path: string,
	command: T,
	...args: Parameters<_ioctl_ops[T]>
): ReturnType<_ioctl_ops[T]> {
	path = normalizePath(path);

	const { fs, path: resolved } = resolveMount(path, this);

	type _rt = ReturnType<_ioctl_ops[T]>;

	try {
		const inode = new Inode(fs.statSync(resolved));

		switch (command) {
			case 'IOC_GETFLAGS':
				return inode.flags as _rt;
			case 'IOC_SETFLAGS':
				inode.flags = (args as Parameters<_ioctl_ops['IOC_SETFLAGS']>)[0];
				fs.touchSync(resolved, inode);
				return undefined as _rt;
			case 'IOC_GETVERSION':
				return inode.version as _rt;
			case 'IOC_SETVERSION':
				inode.version = (args as Parameters<_ioctl_ops['IOC_SETVERSION']>)[0];
				fs.touchSync(resolved, inode);
				return undefined as _rt;
			case 'IOC_FIEMAP':
				break;
			case 'IOC_GETXATTR':
				return new fsxattr(inode) as _rt;

			case 'IOC_SETXATTR':
				break;
			case 'IOC_GETLABEL':
				return fs.label as _rt;
			case 'IOC_SETLABEL':
				fs.label = (args as Parameters<_ioctl_ops['IOC_SETLABEL']>)[0];
				return undefined as _rt;
			case 'IOC_GETUUID':
				return fs.uuid as _rt;
			case 'IOC_GETSYSFSPATH':
				/**
				 * @todo Implement sysfs and have each FS implement the /sys/fs/<name> tree
				 */
				return `/sys/fs/${fs.name}/${fs.uuid}` as _rt;
		}
	} catch (e) {
		throw fixError(e as ErrnoError, { [resolved]: path });
	}

	throw new ErrnoError(Errno.ENOTSUP, 'Unsupported command: ' + command, path, 'ioctl');
}
