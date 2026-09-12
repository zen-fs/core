import { withErrno } from 'kerium';
import type { FileSystem } from './filesystem.js';
import type { InodeLike } from './inode.js';
import { InodeFlags } from './inode.js';

/**
 * Inode flags (FS_IOC_GETFLAGS / FS_IOC_SETFLAGS)
 * @see `FS_*_FL` in `include/uapi/linux/fs.h` (around L250)
 * @experimental
 */
export enum FileFlag {
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

/** User visible flags */
export const userVisibleFlags = 0x0003dfff;
/** User modifiable flags */
export const userModifiableFlags = 0x000380ff;

const flagPairs = [
	[FileFlag.Sync, InodeFlags.Sync],
	[FileFlag.Immutable, InodeFlags.Immutable],
	[FileFlag.Append, InodeFlags.Append],
	[FileFlag.NoAtime, InodeFlags.NoAtime],
	[FileFlag.Encrypt, InodeFlags.Encrypted],
	[FileFlag.DirSync, InodeFlags.Dirsync],
	[FileFlag.Verity, InodeFlags.Verity],
	[FileFlag.Dax, InodeFlags.DAX],
	[FileFlag.CaseFold, InodeFlags.CaseFold],
] satisfies [FileFlag, InodeFlags][];

const supportedFlags: number = flagPairs.reduce((all, [flag]) => all | flag, 0),
	settableFlags: number = flagPairs.reduce((all, [, flag]) => all | flag, 0);

function toFileFlags(flags: number): number {
	let value = 0;
	for (const [file, inode] of flagPairs) if (flags & inode) value |= file;
	return value;
}

function setFlags($: IoctlContext, flags: number): void {
	if (flags & ~supportedFlags) throw withErrno('ENOTSUP', 'Unsupported file flags');

	let value = 0;
	for (const [file, inode] of flagPairs) if (flags & file) value |= inode;

	$.inode.flags = (($.inode.flags || 0) & ~settableFlags) | value;
}

/**
 * `FS_IOC_*` commands for {@link ioctl | `ioctl`}
 */
export enum IOC {
	GetFlags = 0x80086601,
	SetFlags = 0x40086602,
	GetVersion = 0x80087601,
	SetVersion = 0x40087602,
	GetLabel = 0x81009431,
	SetLabel = 0x41009432,
	GetUUID = 0x80111500,
}

/**
 * `FS_IOC32_*` commands for {@link ioctl | `ioctl`}
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
 * What an ioctl takes from whoever is calling it, which is everything but the context it is given.
 * @category ioctl
 */
export type IoctlArgs<T extends Ioctl> = T extends (context: IoctlContext, ...args: infer A) => any ? A : never;

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
		return toFileFlags($.inode.flags);
	},
	[IOC32.GetFlags]($): number {
		if (typeof $.inode.flags !== 'number') throw withErrno('ENOTTY');
		return toFileFlags($.inode.flags);
	},
	[IOC.GetVersion]($): number {
		if (typeof $.inode.version !== 'number') throw withErrno('ENOTTY');
		return $.inode.version;
	},
	[IOC32.GetVersion]($): number {
		if (typeof $.inode.version !== 'number') throw withErrno('ENOTTY');
		return $.inode.version;
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
} satisfies IoctlOps;

/**
 * @internal
 * @category ioctl
 */
export const ioctl_default_ops_async = {
	...ioctl_default_ops,
	async [IOC.SetFlags]($, flags: number): Promise<void> {
		setFlags($, flags);
		await $.fs.touch($.path, $.inode);
	},
	async [IOC32.SetFlags]($, flags: number): Promise<void> {
		setFlags($, flags);
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
		setFlags($, flags);
		$.fs.touchSync($.path, $.inode);
	},
	[IOC32.SetFlags]($, flags: number): void {
		setFlags($, flags);
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
