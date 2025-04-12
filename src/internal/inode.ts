import { withErrno } from 'kerium';
import { crit, warn } from 'kerium/log';
import { field, packed, sizeof, struct, types as t, type Struct } from 'memium';
import { decodeUTF8, encodeUTF8, pick } from 'utilium';
import { BufferView, initView } from 'utilium/buffer.js';
import * as c from '../vfs/constants.js';
import { Stats, type StatsLike } from '../vfs/stats.js';
import { defaultContext, type V_Context } from './contexts.js';

/**
 * Root inode
 * @hidden
 */
export const rootIno = 0;

/** 4 KiB minus static inode data */
const maxDynamicData = 3968;

@struct(packed)
class Attribute<B extends ArrayBufferLike = ArrayBufferLike> extends Uint8Array<B> {
	@t.uint32 public accessor keySize!: number;
	@t.uint32 public accessor valueSize!: number;

	public get name(): string {
		return decodeUTF8(this.subarray(8, 8 + this.keySize));
	}

	/**
	 * Note that this does not handle moving the data.
	 * Changing the name after setting the value is undefined behavior and will lead to corruption.
	 * This should only be used when creating a new attribute.
	 */
	public set name(value: string) {
		const buf = encodeUTF8(value);
		if (8 + buf.length + this.valueSize > maxDynamicData) throw withErrno('EOVERFLOW');
		this.set(buf, 8);
		this.keySize = buf.length;
	}

	public get value(): Uint8Array {
		return this.subarray(8 + this.keySize, this.size);
	}

	public set value(value: Uint8Array) {
		if (8 + this.keySize + value.length > maxDynamicData) throw withErrno('EOVERFLOW');
		this.valueSize = value.length;
		this.set(value, 8 + this.keySize);
	}

	public get size(): number {
		return 8 + this.keySize + this.valueSize;
	}
}

/**
 * Extended attributes
 * @category Internals
 * @internal
 */
@struct(packed)
export class Attributes<T extends ArrayBufferLike = ArrayBufferLike> implements ArrayBufferView<T> {
	@t.uint32 accessor size!: number;

	declare ['constructor']: typeof Attributes;

	declare readonly buffer: T;
	declare readonly byteOffset: number;
	declare readonly byteLength: number;
	constructor(buffer?: T | ArrayBufferView<T> | ArrayLike<number> | number, byteOffset?: number, byteLength?: number) {
		initView(this, buffer, byteOffset, byteLength);
	}

	public get byteSize(): number {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			offset += entry.size;
		}
		return offset;
	}

	public has(name: string): boolean {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			if (entry.name == name) return true;
			offset += entry.size;
		}
		return false;
	}

	public get(name: string): Uint8Array | undefined {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			if (entry.name == name) return entry.value;
			//if (entry.name == name) return new Uint8Array(this.buffer, offset, entry.valueSize);
			offset += entry.size;
		}
	}

	public set(name: string, value: Uint8Array): void {
		let offset = this.byteOffset + sizeof(this);
		let remove;
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			if (entry.name == name) remove = [offset, entry.size];
			offset += entry.size;
		}

		const buf = new Uint8Array(this.buffer);

		if (remove) {
			const [start, size] = remove;
			offset -= size;
			buf.copyWithin(start, start + size, offset + size);
			buf.fill(0, offset, offset + size);
			this.size--;
		}

		const attr = new Attribute(this.buffer, offset);
		attr.name = name;
		attr.value = value;
		this.size++;
	}

	public remove(name: string): boolean {
		let offset = this.byteOffset + sizeof(this);
		let remove;
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			if (entry.name == name) remove = [offset, entry.size];
			offset += entry.size;
		}

		if (!remove) return false;

		const [start, size] = remove;
		const buf = new Uint8Array(this.buffer);
		buf.copyWithin(start, start + size, offset);
		buf.fill(0, offset - size, offset);

		this.size--;
		return true;
	}

	public *keys() {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			yield entry.name;
			offset += entry.size;
		}
	}

	public *values() {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			yield entry.value;
			offset += entry.size;
		}
	}

	public *entries() {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			yield [entry.name, entry.value];
			offset += entry.size;
		}
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
 * 4. >= 128 bytes. Added extended attributes.
 * 5. (current) 4 KiB. Changed to a fixed size to make a lot of size-related stuff easier.
 * @internal @hidden
 */
export const _inode_version = 5;

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
	 * Unrelated to the inode format!
	 */
	@t.uint32 accessor version!: number;

	/**
	 * Padding up to 128 bytes.
	 * This ensures there is enough room for expansion without breaking the ABI.
	 * @internal
	 */
	@t.uint8(48) protected accessor __padding!: Uint8Array;

	@field(Attributes) accessor attributes!: Attributes;

	/**
	 * Since the attribute data uses dynamic arrays,
	 * it is necessary to add this so attributes can be added.
	 * @internal @hidden
	 */
	@t.uint8(maxDynamicData) protected accessor __data!: Uint8Array;

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
