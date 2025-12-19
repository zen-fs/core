// SPDX-License-Identifier: LGPL-3.0-or-later
import type { PathLike } from 'node:fs';
import type { V_Context } from '../internal/contexts.js';
import type { MkdirOptions, OpenOptions, ReaddirOptions, ResolvedPath } from './shared.js';

import { setUVMessage, UV, type Exception, type ExceptionExtra } from 'kerium';
import { decodeUTF8 } from 'utilium';
import * as constants from '../constants.js';
import { contextOf } from '../internal/contexts.js';
import { hasAccess, isDirectory, isSymbolicLink, type InodeLike } from '../internal/inode.js';
import { basename, dirname, join, parse, resolve as resolvePath } from '../path.js';
import { normalizeMode, normalizePath } from '../utils.js';
import { checkAccess } from './config.js';
import { Dirent, ifToDt } from './dir.js';
import { Handle } from './file.js';
import * as flags from './flags.js';
import { resolveMount } from './shared.js';
import { emitChange } from './watchers.js';

/**
 * Resolves the mount and real path for a path.
 * Additionally, any stats fetched will be returned for de-duplication
 * @internal @hidden
 */
export async function resolve($: V_Context, path: string, preserveSymlinks?: boolean, extra?: ExceptionExtra): Promise<ResolvedPath> {
	path = resolvePath.call($, path);

	if (preserveSymlinks) {
		const resolved = resolveMount(path, $, extra);
		const stats = await resolved.fs.stat(resolved.path).catch(() => undefined);
		return { ...resolved, fullPath: path, stats };
	}

	/* Try to resolve it directly. If this works,
	that means we don't need to perform any resolution for parent directories. */
	try {
		const resolved = resolveMount(path, $);

		// Stat it to make sure it exists
		const stats = await resolved.fs.stat(resolved.path);

		if (!isSymbolicLink(stats)) {
			return { ...resolved, fullPath: path, stats };
		}

		const target = resolvePath.call($, dirname(path), await readlink.call($, path));
		return await resolve($, target, preserveSymlinks, extra);
	} catch {
		// Go the long way
	}

	const { base, dir } = parse(path);
	const realDir = dir == '/' ? '/' : (await resolve($, dir, false, extra)).fullPath;
	const maybePath = join(realDir, base);
	const resolved = resolveMount(maybePath, $);

	const stats = await resolved.fs.stat(resolved.path).catch((e: Exception) => {
		if (e.code == 'ENOENT') return;
		throw setUVMessage(Object.assign(e, { syscall: 'stat', path: maybePath }));
	});

	if (!stats) return { ...resolved, fullPath: path };
	if (!isSymbolicLink(stats)) {
		return { ...resolved, fullPath: maybePath, stats };
	}

	const target = resolvePath.call($, realDir, await readlink.call($, maybePath));
	return await resolve($, target, false, extra);
}

/**
 * Opens a file. This helper handles the complexity of file flags.
 * @internal
 */
export async function open($: V_Context, path: PathLike, opt: OpenOptions): Promise<Handle> {
	path = normalizePath(path);
	const mode = normalizeMode(opt.mode, 0o644),
		flag = flags.parse(opt.flag);

	const $ex = { syscall: 'open', path };
	const { fs, path: resolved, stats } = await resolve($, path, opt.preserveSymlinks, $ex);

	if (!stats) {
		if (!(flag & constants.O_CREAT)) throw UV('ENOENT', $ex);

		// Create the file
		const parentStats = await fs.stat(dirname(resolved));
		if (checkAccess && !hasAccess($, parentStats, constants.W_OK)) throw UV('EACCES', 'open', dirname(path));

		if (!isDirectory(parentStats)) throw UV('ENOTDIR', 'open', dirname(path));

		if (!opt.allowDirectory && mode & constants.S_IFDIR) throw UV('EISDIR', 'open', path);

		const { euid: uid, egid: gid } = contextOf($).credentials;

		const inode = await fs.createFile(resolved, {
			mode,
			uid: parentStats.mode & constants.S_ISUID ? parentStats.uid : uid,
			gid: parentStats.mode & constants.S_ISGID ? parentStats.gid : gid,
		});

		return new Handle($, path, fs, resolved, flag, inode);
	}

	if (checkAccess && !hasAccess($, stats, flags.toMode(flag))) throw UV('EACCES', $ex);
	if (flag & constants.O_EXCL) throw UV('EEXIST', $ex);

	const handle = new Handle($, path, fs, resolved, flag, stats);

	if (!opt.allowDirectory && mode & constants.S_IFDIR) throw UV('EISDIR', 'open', path);

	if (flag & constants.O_TRUNC) await handle.truncate(0);

	return handle;
}

export async function readlink(this: V_Context, path: PathLike): Promise<string> {
	path = normalizePath(path);

	const $ex = { syscall: 'readlink', path };
	const { fs, stats, path: resolved } = await resolve(this, path, true, $ex);

	if (!stats) throw UV('ENOENT', $ex);
	if (checkAccess && !hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', $ex);
	if (!isSymbolicLink(stats)) throw UV('EINVAL', $ex);
	const size = stats.size;
	const data = new Uint8Array(size);
	await fs.read(resolved, data, 0, size);
	return decodeUTF8(data);
}

export async function mkdir(this: V_Context, path: PathLike, options: MkdirOptions = {}): Promise<string | void> {
	path = normalizePath(path);
	const { euid: uid, egid: gid } = contextOf(this).credentials;
	const { mode = 0o777, recursive } = options;

	const { fs, path: resolved } = resolveMount(path, this, { syscall: 'mkdir' });

	const __create = async (path: string, resolved: string, parent: InodeLike) => {
		if (checkAccess && !hasAccess(this, parent, constants.W_OK)) throw UV('EACCES', 'mkdir', path);

		const inode = await fs.mkdir(resolved, {
			mode,
			uid: parent.mode & constants.S_ISUID ? parent.uid : uid,
			gid: parent.mode & constants.S_ISGID ? parent.gid : gid,
		});
		emitChange(this, 'rename', path);
		return inode;
	};

	if (!recursive) {
		await __create(path, resolved, await fs.stat(dirname(resolved)));
		return;
	}

	const dirs: [path: string, resolved: string][] = [];
	let origDir = path;
	for (let dir = resolved; !(await fs.exists(dir)); dir = dirname(dir), origDir = dirname(origDir)) {
		dirs.unshift([origDir, dir]);
	}

	if (!dirs.length) return;

	const stats: InodeLike[] = [await fs.stat(dirname(dirs[0][1]))];

	for (const [i, [path, resolved]] of dirs.entries()) {
		stats.push(await __create(path, resolved, stats[i]));
	}
	return dirs[0][0];
}

export async function readdir(this: V_Context, path: PathLike, options: ReaddirOptions = {}): Promise<Dirent[]> {
	path = normalizePath(path);

	const $ex = { syscall: 'readdir', path };
	const { fs, path: resolved, stats } = await resolve(this, path, false, $ex);

	if (!stats) throw UV('ENOENT', $ex);

	if (checkAccess && !hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', $ex);

	if (!isDirectory(stats)) throw UV('ENOTDIR', $ex);

	const entries = await fs.readdir(resolved);

	const values: Dirent[] = [];
	const addEntry = async (entry: string) => {
		const entryStats = await fs.stat(join(resolved, entry)).catch((e: Exception) => {
			if (e.code == 'ENOENT') return;
			throw e;
		});

		if (!entryStats) return;

		const ent = new Dirent();
		ent.ino = entryStats.ino;
		ent.type = ifToDt(entryStats.mode);
		ent.path = entry;
		ent.name = basename(entry);
		values.push(ent);

		if (!options.recursive || !isDirectory(entryStats)) return;

		const children = await fs.readdir(join(resolved, entry));
		for (const child of children) await addEntry(join(entry, child));
	};
	await Promise.all(entries.map(addEntry));
	return values;
}

export async function rename(this: V_Context, oldPath: PathLike, newPath: PathLike): Promise<void> {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const $ex = { syscall: 'rename', path: oldPath, dest: newPath };
	const src = await resolve(this, oldPath, true, $ex);
	const dst = resolveMount(newPath, this, $ex);

	if (src.fs.uuid !== dst.fs.uuid) throw UV('EXDEV', $ex);
	if (dst.path.startsWith(src.path + '/')) throw UV('EBUSY', $ex);
	if (!src.stats) throw UV('ENOENT', $ex);

	const fs = src.fs;

	const oldParent = await fs.stat(dirname(src.path));
	const newParent = await fs.stat(dirname(dst.path));
	const newStats = await fs.stat(dst.path).catch((e: Exception) => {
		if (e.code == 'ENOENT') return null;
		throw e;
	});

	if (checkAccess && (!hasAccess(this, oldParent, constants.R_OK) || !hasAccess(this, newParent, constants.W_OK))) throw UV('EACCES', $ex);

	if (newStats && !isDirectory(src.stats) && isDirectory(newStats)) throw UV('EISDIR', $ex);
	if (newStats && isDirectory(src.stats) && !isDirectory(newStats)) throw UV('ENOTDIR', $ex);

	await src.fs.rename(src.path, dst.path);

	emitChange(this, 'rename', oldPath);
	emitChange(this, 'change', newPath);
}

export async function link(this: V_Context, target: PathLike, link: PathLike): Promise<void> {
	target = normalizePath(target);
	link = normalizePath(link);

	const $ex = { syscall: 'link', path: link, dest: target };
	const { fs, path: resolved } = resolveMount(target, this, $ex);
	const dst = resolveMount(link, this, $ex);

	if (fs.uuid != dst.fs.uuid) throw UV('EXDEV', $ex);

	const stats = await fs.stat(resolved);

	if (checkAccess) {
		if (!hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', $ex);

		const dirStats = await fs.stat(dirname(resolved));
		if (!hasAccess(this, dirStats, constants.R_OK)) throw UV('EACCES', $ex);

		const destStats = await fs.stat(dirname(dst.path));
		if (!hasAccess(this, destStats, constants.W_OK)) throw UV('EACCES', $ex);
	}

	return await fs.link(resolved, dst.path);
}
