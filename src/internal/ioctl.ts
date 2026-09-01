import { Errno, Exception, withErrno } from 'kerium';
import { sizeof } from 'memium';
import { $from, struct, types as t } from 'memium/decorators';
import { _throw } from 'utilium';
import { BufferView } from 'utilium/buffer';
import type { FileSystem } from './filesystem.js';
import type { InodeLike } from './inode.js';
import { InodeFlags } from './inode.js';

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
class fsxattr extends $from(BufferView) {
	static name = 'fsxattr';

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

	public constructor(inode: Readonly<InodeLike> = _throw(new Exception(Errno.EINVAL, 'fsxattr must be initialized with an inode'))) {
		super(new ArrayBuffer(sizeof(fsxattr)));

		this.extsize = inode.size;
		this.nextents = 1;
		this.projid = inode.uid;
		this.cowextsize = inode.size;

		for (const name of Object.keys(InodeFlags) as (keyof typeof InodeFlags)[]) {
			if (!((inode.flags || 0) & InodeFlags[name])) continue;
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

/**
 * @category ioctl
 */
export interface IoctlContext {
	fs: FileSystem;
	inode: InodeLike;
	path: string;
	file?: { position: number; flag: number };
}

/**
 * @category ioctl
 */
export type Ioctl = (context: IoctlContext, ...args: any[]) => any;

/**
 * @category ioctl
 */
export interface IoctlOps extends Record<number, Ioctl> {}

/**
 * @internal
 * @category ioctl
 */
export const ioctl_default_ops = {
	[IOC.GetFlags]($): number {
		if (typeof $.inode.flags !== 'number') throw withErrno('ENOTTY');
		return $.inode.flags;
	},
	[IOC32.GetFlags]($): number {
		if (typeof $.inode.flags !== 'number') throw withErrno('ENOTTY');
		return $.inode.flags;
	},
	[IOC.GetVersion]($): number {
		if (typeof $.inode.version !== 'number') throw withErrno('ENOTTY');
		return $.inode.version;
	},
	[IOC32.GetVersion]($): number {
		if (typeof $.inode.version !== 'number') throw withErrno('ENOTTY');
		return $.inode.version;
	},
	[IOC.Fiemap](): never {
		throw withErrno('ENOTSUP');
	},
	[IOC.GetXattr]($, _name: string): fsxattr {
		return new fsxattr($.inode);
	},
	[IOC.SetXattr]($, _name: string, _value: fsxattr): never {
		throw withErrno('ENOTSUP');
	},
	[IOC.GetLabel]($): string | undefined {
		return $.fs.label;
	},
	[IOC.SetLabel]($, label: string): void {
		$.fs.label = label;
	},
	[IOC.GetUUID]($): string {
		return $.fs.uuid;
	},
	[IOC.GetSysfsPath]($): string {
		/**
		 * Returns the path component under /sys/fs/ that refers to this filesystem;
		 * also /sys/kernel/debug/ for filesystems with debugfs exports
		 * @todo Implement sysfs and have each FS implement the /sys/fs/<name> tree
		 */
		return `/sys/fs/${$.fs.name}/${$.fs.uuid}`;
	},
} satisfies IoctlOps;

/**
 * @internal
 * @category ioctl
 */
export const ioctl_default_ops_async = {
	...ioctl_default_ops,
	async [IOC.SetFlags]($, flags: number): Promise<void> {
		$.inode.flags = flags;
		await $.fs.touch($.path, $.inode);
	},
	async [IOC32.SetFlags]($, flags: number): Promise<void> {
		$.inode.flags = flags;
		await $.fs.touch($.path, $.inode);
	},
	async [IOC.SetVersion]($, version: number): Promise<void> {
		$.inode.version = version;
		await $.fs.touch($.path, $.inode);
	},
	async [IOC32.SetVersion]($, version: number): Promise<void> {
		$.inode.version = version;
		await $.fs.touch($.path, $.inode);
	},
} satisfies IoctlOps;

type _IoctlOpsAsync = typeof ioctl_default_ops_async;
/**
 * @internal
 * @category ioctl
 */
export interface IoctlDefaultAsyncOps extends _IoctlOpsAsync {}

/**
 * @internal
 * @category ioctl
 */
export const ioctl_default_ops_sync = {
	...ioctl_default_ops,
	[IOC.SetFlags]($, flags: number): void {
		$.inode.flags = flags;
		$.fs.touchSync($.path, $.inode);
	},
	[IOC32.SetFlags]($, flags: number): void {
		$.inode.flags = flags;
		$.fs.touchSync($.path, $.inode);
	},
	[IOC.SetVersion]($, version: number): void {
		$.inode.version = version;
		$.fs.touchSync($.path, $.inode);
	},
	[IOC32.SetVersion]($, version: number): void {
		$.inode.version = version;
		$.fs.touchSync($.path, $.inode);
	},
} satisfies IoctlOps;

type _IoctlOpsSync = typeof ioctl_default_ops_sync;

/**
 * @internal
 * @category ioctl
 */
export interface IoctlDefaultSyncOps extends _IoctlOpsSync {}
