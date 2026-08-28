// SPDX-License-Identifier: LGPL-3.0-or-later
import type { LockMode, LockRelease } from 'kerium/locks';
import { err } from 'kerium/log';
import type { UUID } from 'node:crypto';
import type { FileSystem } from '../internal/filesystem.js';
import type { InodeLike } from '../internal/inode.js';
import { VNode } from './vnode.js';

/**
 * The VFS-level cache of vnodes for a single file system. Modeled after Linux's dcache/icache.
 *
 * Vnodes are keyed by inode number, so hard links share a vnode.
 * A vnode stays cached while it is referenced or dirty, and is evicted otherwise.
 * @category VFS
 * @todo Add LRU or something to limit memory usage
 */
export class VCache {
	protected byIno = new Map<number, VNode>();
	protected byPath = new Map<string, VNode>();

	public constructor(public readonly fs: FileSystem) {}

	/** Get the vnode for a path, if one is cached. Note paths are relative to the FS root, not the VFS root */
	public get(path: string): VNode | undefined {
		return this.byPath.get(path);
	}

	/**
	 * Get or create the vnode for `path`, incrementing its reference count.
	 * Callers must `unref` the vnode when done with it.
	 */
	public ref(path: string, inode: InodeLike): VNode {
		let node = this.byIno.get(inode.ino);

		if (node && node.inode.nlink === node.paths.size && !node.paths.has(path))
			err(
				`vcache.ref: vnode for ${this.fs.label || this.fs.uuid}:${inode.ino} has an nlink of ${node.inode.nlink} but referenced by more paths [#314]`
			);

		if (!node) {
			node = new VNode(this.fs, path, inode);
			this.byIno.set(inode.ino, node);
		} else {
			node.paths.add(path);
			// The vnode's inode is authoritative when dirty; otherwise refresh it with the newer stats
			if (!node.dirty && inode !== node.inode) Object.assign(node.inode, inode);
		}

		this.byPath.set(path, node);
		node.refs++;
		return node;
	}

	/** Release a reference to a vnode, evicting it if it is unreferenced and clean */
	public unref(node: VNode): void {
		node.refs--;
		if (node.refs > 0 || node.dirty) return;
		this.evict(node);
	}

	protected evict(node: VNode): void {
		this.byIno.delete(node.ino);
		for (const path of node.paths) this.byPath.delete(path);
	}

	/** Update cached paths for a rename. Handles directories, whose descendants' paths change too */
	public rename(oldPath: string, newPath: string): void {
		for (const [path, node] of this.byPath) {
			if (path != oldPath && !path.startsWith(oldPath + '/')) continue;

			const moved = newPath + path.slice(oldPath.length);
			this.byPath.delete(path);
			this.byPath.set(moved, node);
			node.paths.delete(path);
			node.paths.add(moved);
		}
	}

	/** Add a path for a newly created hard link, if the target is cached */
	public link(targetPath: string, linkPath: string): void {
		const node = this.byPath.get(targetPath);
		if (!node) return;
		node.paths.add(linkPath);
		this.byPath.set(linkPath, node);
	}

	/** Remove a path for an unlink/rmdir. The vnode is kept if other paths (hard links) refer to it */
	public remove(path: string): void {
		const node = this.byPath.get(path);
		if (!node) return;

		this.byPath.delete(path);
		node.paths.delete(path);

		if (!node.paths.size && !node.refs) this.evict(node);
	}

	/** Sync all dirty vnodes to the backend */
	public async sync(): Promise<void> {
		for (const node of this.byIno.values()) {
			if (!node.dirty) continue;
			using _ = await node.lock('rw');
			await node.sync();
			if (!node.refs) this.evict(node);
		}
	}

	/** Sync all dirty vnodes to the backend synchronously */
	public syncSync(): void {
		for (const node of this.byIno.values()) {
			if (!node.dirty) continue;
			using _ = node.lockSync('rw');
			node.syncSync();
			if (!node.refs) this.evict(node);
		}
	}
}

/**
 * All vnode caches, keyed by file system UUID.
 * Keyed by UUID rather than the `FileSystem` object because `resolveMount`
 * wraps file systems in a new exception-context proxy on every call.
 * @category VFS
 * @internal
 */
export const caches = new Map<UUID, VCache>();

/**
 * Get the vnode cache for a file system, creating it if needed.
 * @category VFS
 * @internal
 */
export function cacheOf(fs: FileSystem): VCache {
	let cache = caches.get(fs.uuid);
	if (!cache) {
		cache = new VCache(fs);
		caches.set(fs.uuid, cache);
	}
	return cache;
}

/**
 * Ref and lock the vnode for a path, usually a parent directory during a namespace operation.
 * The returned release function unlocks and unrefs the vnode.
 * If `inode` is not provided and the vnode is not cached, the backend is `stat`ed.
 * @category VFS
 * @internal
 */
export async function lockPath(fs: FileSystem, path: string, mode: LockMode, inode?: InodeLike): Promise<LockRelease> {
	const cache = cacheOf(fs);
	inode ??= cache.get(path)?.inode ?? (await fs.stat(path));
	const node = cache.ref(path, inode);
	const unlock = await node.lock(mode);

	let released = false;
	const release = (): void => {
		if (released) return;
		released = true;
		unlock();
		cache.unref(node);
	};
	release[Symbol.dispose] = release;
	return release;
}

/**
 * Synchronous version of `lockPath`.
 * @category VFS
 * @internal
 */
export function lockPathSync(fs: FileSystem, path: string, mode: LockMode, inode?: InodeLike): LockRelease {
	const cache = cacheOf(fs);
	inode ??= cache.get(path)?.inode ?? fs.statSync(path);
	const node = cache.ref(path, inode);

	let unlock: LockRelease;
	try {
		unlock = node.lockSync(mode);
	} catch (e) {
		cache.unref(node);
		throw e;
	}

	let released = false;
	const release = (): void => {
		if (released) return;
		released = true;
		unlock();
		cache.unref(node);
	};
	release[Symbol.dispose] = release;
	return release;
}
