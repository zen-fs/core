import { withErrno } from 'kerium';
import { crit, warn } from 'kerium/log';
import { field, packed, sizeof, struct, types as t, type Struct } from 'memium';
import { decodeUTF8, encodeUTF8, pick } from 'utilium';
import { BufferView } from 'utilium/buffer.js';
import * as c from '../vfs/constants.js';
import { Stats, type StatsLike } from '../vfs/stats.js';
import { defaultContext, type V_Context } from './contexts.js';

/**
 * Root inode
 * @hidden
 */
export const rootIno = 0;

const maxAttrValueSize = 1024;

@struct(packed)
class Attribute extends BufferView {
	@t.uint32 protected accessor keySize!: number;
	@t.uint32 protected accessor valueSize!: number;

	@t.char(0, { countedBy: 'keySize' }) protected accessor _name!: Uint8Array;

	public get name(): string {
		return decodeUTF8(this._name).replace(/\0/g, '');
	}

	public set name(value: string) {
		this._name = encodeUTF8(value);
		this.keySize = this._name.length;
	}

	@t.uint8(maxAttrValueSize, { countedBy: 'valueSize' }) protected accessor _value!: Uint8Array;

	public get value(): Uint8Array {
		return this._value;
	}

	public set value(value: Uint8Array) {
		this._value = value;
		this.valueSize = Math.min(value.length, maxAttrValueSize);
	}
}

/**
 * Extended attributes
 * @category Internals
 * @internal
 */
@struct(packed)
export class Attributes extends BufferView {
	@t.uint32 accessor size!: number;

	@field(Attribute, { length: 0, countedBy: 'size' }) accessor data!: Attribute[];

	public has(name: string): boolean {
		return this.data.some(entry => entry.name == name);
	}

	public get(name: string): Attribute | undefined {
		return this.data.find(entry => entry.name == name);
	}

	public set(name: string, value: Uint8Array): void {
		const attr = this.get(name);

		if (attr) {
			attr.value = value;
			return;
		}

		const new_attr = new Attribute();
		new_attr.name = name;
		new_attr.value = value;
		this.data.push(new_attr);
		this.size++;
	}

	public remove(name: string): boolean {
		const index = this.data.findIndex(entry => entry.name == name);
		if (index === -1) return false;
		this.data.splice(index, 1);
		this.size--;
		return true;
	}

	public keys(): string[] {
		return this.data.map(entry => entry.name);
	}

	public values(): Uint8Array[] {
		return this.data.map(entry => entry.value);
	}

	public entries(): [string, Uint8Array][] {
		return this.data.map(entry => [entry.name, entry.value]);
	}
}

/**
 * @internal @hidden
 */
export interface InodeFields {
	data?: number;
	flags?: number;
	version?: number;
}

/**
 * @category Internals
 * @internal
 */
export interface InodeLike extends StatsLike<number>, InodeFields {
	attributes?: Attributes;
}

/**
 * @internal @hidden
 */
export const _inode_fields = [
	'ino',
	'data',
	'size',
	'mode',
	'flags',
	'nlink',
	'uid',
	'gid',
	'atimeMs',
	'birthtimeMs',
	'mtimeMs',
	'ctimeMs',
	'version',
] as const;

/**
 * Represents which version of the `Inode` format we are on.
 * 1. 58 bytes. The first member was called `ino` but used as the ID for data.
 * 2. 66 bytes. Renamed the first member from `ino` to `data` and added a separate `ino` field
 * 3. 72 bytes. Changed the ID fields from 64 to 32 bits and added `flags`.
 * 4. (current) Added extended attributes. At least 128 bytes.
 * @internal @hidden
 */
export const _inode_version = 4;

/**
 * Inode flags (FS_IOC_GETFLAGS / FS_IOC_SETFLAGS)
 * @see `FS_*_FL` in `include/uapi/linux/fs.h` (around L250)
 * @experimental
 */
export enum InodeFlags {
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

/**
 * Generic inode definition that can easily be serialized.
 * @category Internals
 * @internal
 */
@struct(packed)
export class Inode extends BufferView implements InodeLike {
	declare static readonly [Symbol.metadata]: { struct: Struct.Metadata };

	public constructor(...args: ConstructorParameters<typeof BufferView> | [Readonly<Partial<InodeLike>>]) {
		let data = {};

		if (typeof args[0] === 'object' && args[0] !== null && !('length' in args[0])) {
			data = args[0];
			args = [new ArrayBuffer(Inode[Symbol.metadata].struct.size)];
		}

		super(...(args as ConstructorParameters<typeof BufferView>));

		if (this.byteLength < sizeof(Inode)) {
			throw crit(withErrno('EIO', `Buffer is too small to create an inode (${this.byteLength} bytes)`));
		}

		Object.assign(this, data);

		this.atimeMs ||= Date.now();
		this.mtimeMs ||= Date.now();
		this.ctimeMs ||= Date.now();
		this.birthtimeMs ||= Date.now();

		if (this.ino && !this.nlink) {
			warn(`Inode ${this.ino} has an nlink of 0`);
		}
	}

	@t.uint32 accessor data!: number;
	/** For future use */
	@t.uint32 accessor __data_old!: number;
	@t.uint32 accessor size!: number;
	@t.uint16 accessor mode!: number;
	@t.uint32 accessor nlink!: number;
	@t.uint32 accessor uid!: number;
	@t.uint32 accessor gid!: number;
	@t.float64 accessor atimeMs!: number;
	@t.float64 accessor birthtimeMs!: number;
	@t.float64 accessor mtimeMs!: number;

	/**
	 * The time the inode was changed.
	 *
	 * This is automatically updated whenever changed are made using `update()`.
	 */
	@t.float64 accessor ctimeMs!: number;

	@t.uint32 accessor ino!: number;
	/** For future use */
	@t.uint32 accessor __ino_old!: number;
	@t.uint32 accessor flags!: number;
	/** For future use */
	@t.uint16 protected accessor __after_flags!: number;

	/**
	 * The "version" of the inode/data.
	 *
	 * Unrelated to the inode format!
	 */
	@t.uint32 accessor version!: number;

	/** Pad to 128 bytes */
	@t.uint8(48) protected accessor __padding!: Uint8Array;

	@field(Attributes) accessor attributes!: Attributes;

	public toString(): string {
		return `<Inode ${this.ino}>`;
	}

	public toJSON(): InodeLike {
		return {
			...pick(this, _inode_fields),
			attributes: this.attributes,
		};
	}

	/**
	 * Handy function that converts the Inode to a Node Stats object.
	 */
	public toStats(): Stats {
		return new Stats(this);
	}

	/**
	 * Updates the Inode using information from the stats object. Used by file
	 * systems at sync time, e.g.:
	 * - Program opens file and gets a File object.
	 * - Program mutates file. File object is responsible for maintaining
	 *   metadata changes locally -- typically in a Stats object.
	 * - Program closes file. File object's metadata changes are synced with the
	 *   file system.
	 * @returns whether any changes have occurred.
	 */
	public update(data?: Partial<Readonly<InodeLike>>): boolean {
		if (!data) return false;

		let hasChanged = false;

		for (const key of _inode_fields) {
			if (data[key] === undefined) continue;

			// When multiple StoreFSes are used in a single stack, the differing IDs end up here.
			if (key == 'ino' || key == 'data') continue;

			if (this[key] === data[key]) continue;
			if (key == 'atimeMs' && this.flags & InodeFlags.NoAtime) continue;

			this[key] = data[key];

			hasChanged = true;
		}

		if (data.attributes) {
			this.attributes = data.attributes;
			hasChanged = true;
		}

		if (hasChanged) this.ctimeMs = Date.now();

		return hasChanged;
	}
}

export function isFile(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFREG;
}

export function isDirectory(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFDIR;
}

export function isSymbolicLink(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFLNK;
}

export function isSocket(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFSOCK;
}

export function isBlockDevice(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFBLK;
}

export function isCharacterDevice(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFCHR;
}

export function isFIFO(metadata: { mode: number }): boolean {
	return (metadata.mode & c.S_IFMT) === c.S_IFIFO;
}

/**
 * Checks if a given user/group has access to this item
 * @param access The requested access, combination of `W_OK`, `R_OK`, and `X_OK`
 * @internal
 */
export function hasAccess($: V_Context, inode: Pick<InodeLike, 'mode' | 'uid' | 'gid'>, access: number): boolean {
	const credentials = $?.credentials || defaultContext.credentials;

	if (isSymbolicLink(inode) || credentials.euid === 0 || credentials.egid === 0) return true;

	let perm = 0;

	if (credentials.uid === inode.uid) {
		if (inode.mode & c.S_IRUSR) perm |= c.R_OK;
		if (inode.mode & c.S_IWUSR) perm |= c.W_OK;
		if (inode.mode & c.S_IXUSR) perm |= c.X_OK;
	}

	if (credentials.gid === inode.gid || credentials.groups.includes(Number(inode.gid))) {
		if (inode.mode & c.S_IRGRP) perm |= c.R_OK;
		if (inode.mode & c.S_IWGRP) perm |= c.W_OK;
		if (inode.mode & c.S_IXGRP) perm |= c.X_OK;
	}

	if (inode.mode & c.S_IROTH) perm |= c.R_OK;
	if (inode.mode & c.S_IWOTH) perm |= c.W_OK;
	if (inode.mode & c.S_IXOTH) perm |= c.X_OK;

	return (perm & access) === access;
}
