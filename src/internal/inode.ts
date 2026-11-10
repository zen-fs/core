// SPDX-License-Identifier: LGPL-3.0-or-later
import { UV, withErrno, type ExceptionExtra } from 'kerium';
import { crit, warn } from 'kerium/log';
import { sizeof, struct, types as t } from 'memium';
import { decodeUTF8, encodeUTF8, pick } from 'utilium';
import * as c from '../constants.js';
import { checkAccess } from '../vfs/config.js';
import { contextOf, type V_Context } from './contexts.js';

/**
 * Root inode
 * @hidden
 */
export const rootIno = 0n;

/** 4 KiB minus static inode data */
const maxDynamicData = 3968;

class Attribute extends struct.packed('Attribute', { keySize: t.uint32, valueSize: t.uint32 }, { fastFields: true }) {
	protected data(isValue: boolean, length: number): Uint8Array {
		return new Uint8Array(this.buffer, this.byteOffset + 8 + (isValue ? this.keySize : 0), length);
	}

	public get name(): string {
		return decodeUTF8(this.data(false, this.keySize));
	}

	/**
	 * Note that this does not handle moving the data.
	 * Changing the name after setting the value is undefined behavior and will lead to corruption.
	 * This should only be used when creating a new attribute.
	 */
	public set name(value: string) {
		const buf = encodeUTF8(value);
		if (8 + buf.length + this.valueSize > maxDynamicData) throw withErrno('EOVERFLOW');
		this.data(false, buf.length).set(buf);
		this.keySize = buf.length;
	}

	public get value(): Uint8Array {
		return this.data(true, this.valueSize);
	}

	public set value(value: Uint8Array) {
		if (8 + this.keySize + value.length > maxDynamicData) throw withErrno('EOVERFLOW');
		this.valueSize = value.length;
		this.data(true, value.length).set(value);
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
export class Attributes extends struct.packed('Attributes', { size: t.uint32 }) implements Map<string, Uint8Array> {
	public get byteSize(): number {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			offset += entry.size;
		}
		return offset - this.byteOffset;
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
			offset += entry.size;
		}
	}

	public getOrInsert(name: string, defaultValue: Uint8Array): Uint8Array {
		return this.getOrInsertComputed(name, () => defaultValue);
	}

	public getOrInsertComputed(name: string, callback: (name: string) => Uint8Array): Uint8Array {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			if (entry.name == name) return entry.value;
			offset += entry.size;
		}

		const attr = new Attribute(this.buffer, offset);
		attr.name = name;
		attr.value = callback(name);
		this.size++;
		return attr.value;
	}

	public set(name: string, value: Uint8Array): this {
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
		return this;
	}

	public delete(name: string): boolean {
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

	public clear(): void {
		new Uint8Array(this.buffer, this.byteOffset, this.byteSize).fill(0);
	}

	public copyFrom(other: Attributes): void {
		const { byteSize } = other;
		const bytes = new Uint8Array(this.buffer, this.byteOffset, Math.max(byteSize, this.byteSize));
		bytes.set(new Uint8Array(other.buffer, other.byteOffset, byteSize));
		bytes.fill(0, byteSize);
	}

	public *keys(): MapIterator<string> {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			yield entry.name;
			offset += entry.size;
		}
	}

	public *values(): MapIterator<Uint8Array> {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			yield entry.value;
			offset += entry.size;
		}
	}

	public *entries(): MapIterator<[string, Uint8Array]> {
		let offset = this.byteOffset + sizeof(this);
		for (let i = 0; i < this.size; i++) {
			const entry = new Attribute(this.buffer, offset);
			yield [entry.name, entry.value];
			offset += entry.size;
		}
	}

	public forEach(callback: (value: Uint8Array, name: string, attributes: this) => void, thisArg?: unknown): void {
		for (const [name, value] of this.entries()) callback.call(thisArg, value, name, this);
	}

	public [Symbol.iterator](): MapIterator<[string, Uint8Array]> {
		return this.entries();
	}
}

/**
 * @internal @hidden
 */
export interface InodeFields {
	data?: bigint;
	flags?: number;
	version?: number;
	/** Extended attributes */
	attributes?: Attributes;
}

export interface StatsLike<T extends number | bigint = number | bigint> {
	/** Size of the item in bytes. For directories/symlinks, this may be the size of the struct that represents the item. */
	size: T;
	/** Unix-style file mode (e.g. 0o644) that includes the item type */
	mode: T;
	/** Time of last access, since epoch */
	atimeMs: T;
	/** Time of last modification, since epoch */
	mtimeMs: T;
	/** Time of last time file status was changed, since epoch */
	ctimeMs: T;
	/** Time of file creation, since epoch */
	birthtimeMs: T;
	/** The id of the user that owns the file */
	uid: T;
	/** The id of the group that owns the file */
	gid: T;
	/** Inode number */
	ino: T;
	/** Number of hard links */
	nlink: T;
	/** Device ID for special files */
	rdev: T;
}

/**
 * @category Internals
 * @internal
 */
export interface InodeLike extends InodeFields, Omit<StatsLike<number>, 'ino'> {
	/** Inode number */
	ino: bigint;
}

/**
 * An `InodeLike` in JSON, where IDs are numbers or, when too large for a number, strings
 * @category Internals
 * @internal
 */
export interface InodeJSON extends Omit<InodeLike, 'ino' | 'data'> {
	ino: number | string;
	data?: number | string;
}

function idToJSON(id: bigint): number | string {
	return id <= Number.MAX_SAFE_INTEGER ? Number(id) : id.toString();
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
	'rdev',
] as const;

/**
 * Represents which version of the `Inode` format we are on.
 * 1. 58 bytes. The first member was called `ino` but used as the ID for data.
 * 2. 66 bytes. Renamed the first member from `ino` to `data` and added a separate `ino` field
 * 3. 72 bytes. Changed the ID fields from 64 to 32 bits and added `flags`.
 * 4. >= 128 bytes. Added extended attributes.
 * 5. (current) 4 KiB. Changed flags. IDs were widened to 64 bits in 3.0 without changing the layout.
 * @internal @hidden
 */
export const _inode_version = 5;

/**
 * Inode flags
 * @see `S_*` in `include/linux/fs.h` (around L2325)
 * @experimental
 */
export enum InodeFlags {
	/** Writes are synced at once */
	Sync = 1 << 0,
	/** Do not update access times */
	NoAtime = 1 << 1,
	/** Append-only file */
	Append = 1 << 2,
	/** Immutable file */
	Immutable = 1 << 3,
	/** removed, but still open directory */
	Dead = 1 << 4,
	/** Inode is not counted to quota */
	NoQuota = 1 << 5,
	/** Directory modifications are synchronous */
	Dirsync = 1 << 6,
	/** Do not update file c/mtime */
	NoCMtime = 1 << 7,
	/** Do not truncate: swapon got its bmaps */
	SwapFile = 1 << 8,
	/** Inode is fs-internal */
	Private = 1 << 9,
	/** Inode has an associated IMA struct */
	IMA = 1 << 10,
	/** Automount/referral quasi-directory */
	AutoMount = 1 << 11,
	/** no suid or xattr security attributes */
	NoSec = 1 << 12,
	/** Direct Access, avoiding the page cache */
	DAX = 1 << 13,
	/** Encrypted file (using fs/crypto/) */
	Encrypted = 1 << 14,
	/** Casefolded file */
	CaseFold = 1 << 15,
	/** Verity file (using fs/verity/) */
	Verity = 1 << 16,
	/** File is in use by the kernel (eg. fs/cachefiles) */
	KernelFile = 1 << 17,
}

/**
 * Generic inode definition that can easily be serialized.
 * @category Internals
 * @internal
 */
export class Inode
	extends struct.packed('Inode', {
		data: t.uint64,
		size: t.uint32,
		mode: t.uint16,
		nlink: t.uint32,
		uid: t.uint32,
		gid: t.uint32,
		atimeMs: t.float64,
		birthtimeMs: t.float64,
		mtimeMs: t.float64,

		/**
		 * The time the inode was changed.
		 *
		 * This is automatically updated whenever changed are made using `update()`.
		 */
		ctimeMs: t.float64,

		ino: t.uint64,
		flags: t.uint32,
		/** For future use */
		__after_flags: t.uint16,

		/**
		 * The "version" of the inode/data.
		 * Unrelated to the inode format!
		 */
		version: t.uint32,

		rdev: t.uint32,

		/**
		 * Padding up to 128 bytes.
		 * This ensures there is enough room for expansion without breaking the ABI.
		 * @internal
		 */
		__padding: t.uint8(44),

		attributes: Attributes,

		/**
		 * Since the attribute data uses dynamic arrays,
		 * it is necessary to add this so attributes can be added.
		 * @internal @hidden
		 */
		__data: t.uint8(maxDynamicData),
	})
	implements InodeLike
{
	/** Views are copied, while an `ArrayBuffer` is used as-is */
	public constructor(data?: ArrayBufferLike | ArrayBufferView | Readonly<Partial<InodeLike>>, byteOffset?: number, byteLength?: number) {
		const init = data && !ArrayBuffer.isView(data) && !('byteLength' in data) ? data : undefined;

		if (ArrayBuffer.isView(data)) super(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer);
		else if (data && !init) super(data, byteOffset, byteLength);
		else super(new ArrayBuffer(sizeof(Inode)));

		if (this.byteLength < sizeof(Inode)) {
			throw crit(withErrno('EIO', `Buffer is too small to create an inode (${this.byteLength} bytes)`));
		}

		Object.assign(this, init);

		this.atimeMs ||= Date.now();
		this.mtimeMs ||= Date.now();
		this.ctimeMs ||= Date.now();
		this.birthtimeMs ||= Date.now();

		if (this.ino && !this.nlink) {
			warn(`Inode ${this.ino} has an nlink of 0`);
		}
	}

	public toString(): string {
		return `<Inode ${this.ino}>`;
	}

	public toJSON(): InodeJSON {
		return {
			...pick(this, _inode_fields),
			ino: idToJSON(this.ino),
			data: idToJSON(this.data),
			attributes: this.attributes,
		};
	}

	public static fromJSON({ ino, data, ...rest }: InodeJSON): Inode {
		return new Inode({ ...rest, ino: BigInt(ino), data: data === undefined ? undefined : BigInt(data) });
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
			this.attributes.copyFrom(data.attributes);
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
	const { credentials } = contextOf($);

	if (isSymbolicLink(inode)) return true;

	if (credentials.euid === 0) return !(access & c.X_OK) || isDirectory(inode) || !!(inode.mode & (c.S_IXUSR | c.S_IXGRP | c.S_IXOTH));

	let perm = 0;

	if (credentials.euid === inode.uid) {
		if (inode.mode & c.S_IRUSR) perm |= c.R_OK;
		if (inode.mode & c.S_IWUSR) perm |= c.W_OK;
		if (inode.mode & c.S_IXUSR) perm |= c.X_OK;
	} else if (credentials.egid === inode.gid || credentials.groups.includes(Number(inode.gid))) {
		if (inode.mode & c.S_IRGRP) perm |= c.R_OK;
		if (inode.mode & c.S_IWGRP) perm |= c.W_OK;
		if (inode.mode & c.S_IXGRP) perm |= c.X_OK;
	} else {
		if (inode.mode & c.S_IROTH) perm |= c.R_OK;
		if (inode.mode & c.S_IWOTH) perm |= c.W_OK;
		if (inode.mode & c.S_IXOTH) perm |= c.X_OK;
	}

	return (perm & access) === access;
}

/**
 * Throws if a given user may not search the directory `dir`
 * @internal
 */
export function assertSearchable($: V_Context, dir: Pick<InodeLike, 'mode' | 'uid' | 'gid'>, extra?: ExceptionExtra): void {
	if (checkAccess && !hasAccess($, dir, c.X_OK)) throw UV('EACCES', extra);
}

/**
 * Throws if a given user may not remove `entry` from the directory `parent`
 * @internal
 */
export function assertRemovable(
	$: V_Context,
	parent: Pick<InodeLike, 'mode' | 'uid' | 'gid'>,
	entry: Pick<InodeLike, 'uid'>,
	extra?: ExceptionExtra,
): void {
	if (!checkAccess) return;

	if (!hasAccess($, parent, c.W_OK | c.X_OK)) throw UV('EACCES', extra);

	const { euid } = contextOf($).credentials;
	if (parent.mode & c.S_ISVTX && euid !== 0 && euid !== entry.uid && euid !== parent.uid) throw UV('EPERM', extra);
}

/**
 * Throws if a given user is neither root nor the owner of `inode`
 * @internal
 */
export function assertOwner($: V_Context, inode: Pick<InodeLike, 'uid'>, extra?: ExceptionExtra): void {
	if (!checkAccess) return;

	const { euid } = contextOf($).credentials;
	if (euid !== 0 && euid !== inode.uid) throw UV('EPERM', extra);
}

/**
 * Throws if a given user may not change the owner of `inode` to `uid` and `gid`, where `-1` leaves an ID unchanged
 * @internal
 */
export function assertCanChown($: V_Context, inode: Pick<InodeLike, 'uid' | 'gid'>, uid: number, gid: number, extra?: ExceptionExtra): void {
	if (!checkAccess) return;

	const { euid, egid, groups } = contextOf($).credentials;
	if (euid === 0) return;

	const isOwner = euid === inode.uid;
	if (uid !== -1 && !(isOwner && uid === inode.uid)) throw UV('EPERM', extra);
	if (gid !== -1 && !(isOwner && (gid === inode.gid || gid === egid || groups.includes(gid)))) throw UV('EPERM', extra);
}

/**
 * @hidden @internal
 *
 * @todo https://github.com/nodejs/node/pull/58836 support -1 for `*chown`
 */
export function _chown(stats: Partial<InodeLike>, uid: number, gid: number): boolean {
	let valid = true;

	if (!isNaN(uid) && uid >= 0 && uid < c.size_max) stats.uid = uid;
	else valid = false;

	if (!isNaN(gid) && gid >= 0 && gid < c.size_max) stats.gid = gid;
	else valid = false;

	if (stats.mode !== undefined && !isDirectory({ mode: stats.mode })) {
		stats.mode &= ~c.S_ISUID;
		if (stats.mode & c.S_IXGRP) stats.mode &= ~c.S_ISGID;
	}

	return valid;
}

/**
 * @hidden @internal
 */
export function _chmod($: V_Context, inode: Pick<InodeLike, 'mode' | 'gid'>, mode: number): void {
	const { euid, egid, groups } = contextOf($).credentials;
	if (checkAccess && euid !== 0 && egid !== inode.gid && !groups.includes(inode.gid)) mode &= ~c.S_ISGID;

	inode.mode = (inode.mode & (mode > c.S_IFMT ? ~c.S_IFMT : c.S_IFMT)) | mode;
}
