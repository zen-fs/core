// SPDX-License-Identifier: LGPL-3.0-or-later
import type { PathLike } from 'node:fs';
import type { V_Context } from '../context.js';
import type { InodeLike } from '../internal/inode.js';
import type { MkdirOptions, OpenOptions, ReaddirOptions, ResolvedPath } from './shared.js';

import { setUVMessage, UV, type ExceptionExtra } from 'kerium';
import { decodeUTF8 } from 'utilium';
import * as constants from '../constants.js';
import { contextOf } from '../internal/contexts.js';
import { hasAccess, isDirectory, isSymbolicLink } from '../internal/inode.js';
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
 * @category VFS
 * @internal @hidden
 */
export function resolve($: V_Context, path: string, preserveSymlinks?: boolean, extra?: ExceptionExtra): ResolvedPath {
	path = resolvePath.call($, path);
	/* Try to resolve it directly. If this works,
	that means we don't need to perform any resolution for parent directories. */
	try {
		const resolved = resolveMount(path, $);

		// Stat it to make sure it exists
		const stats = resolved.fs.statSync(resolved.path);

		if (!isSymbolicLink(stats) || preserveSymlinks) {
			return { ...resolved, fullPath: path, stats };
		}

		const target = resolvePath.call($, dirname(path), readlink.call($, path));
		return resolve($, target, preserveSymlinks, extra);
	} catch (e: any) {
		setUVMessage(Object.assign(e, { syscall: 'stat', path }));
		if (preserveSymlinks) throw e;
	}

	const { base, dir } = parse(path);
	const realDir = dir == '/' ? '/' : resolve($, dir, false, extra).fullPath;
	const maybePath = join(realDir, base);
	const resolved = resolveMount(maybePath, $);

	let stats: InodeLike | undefined;
	try {
		stats = resolved.fs.statSync(resolved.path);
	} catch (e: any) {
		if (e.code === 'ENOENT') return { ...resolved, fullPath: path };
		throw setUVMessage(Object.assign(e, { syscall: 'stat', path: maybePath }));
	}

	if (!isSymbolicLink(stats)) {
		return { ...resolved, fullPath: maybePath, stats };
	}

	const target = resolvePath.call($, realDir, readlink.call($, maybePath));
	return resolve($, target, false, extra);
}

/**
 * @category VFS
 * @internal
 */
export function open(this: V_Context, path: PathLike, opt: OpenOptions): Handle {
	path = normalizePath(path);
	const mode = normalizeMode(opt.mode, 0o644),
		flag = flags.parse(opt.flag);

	path = opt.preserveSymlinks ? path : resolve(this, path).fullPath;
	const { fs, path: resolved } = resolveMount(path, this);

	let stats: InodeLike | undefined;
	try {
		stats = fs.statSync(resolved);
	} catch {
		// nothing
	}

	if (!stats) {
		if (!(flag & constants.O_CREAT)) {
			throw UV('ENOENT', 'open', path);
		}
		// Create the file
		const parentStats = fs.statSync(dirname(resolved));
		if (checkAccess && !hasAccess(this, parentStats, constants.W_OK)) {
			throw UV('EACCES', 'open', path);
		}

		if (!isDirectory(parentStats)) {
			throw UV('ENOTDIR', 'open', path);
		}

		if (!opt.allowDirectory && mode & constants.S_IFDIR) throw UV('EISDIR', 'open', path);

		if (checkAccess && !hasAccess(this, parentStats, constants.W_OK)) {
			throw UV('EACCES', 'open', path);
		}

		const { euid: uid, egid: gid } = contextOf(this).credentials;
		const inode = fs.createFileSync(resolved, {
			mode,
			uid: parentStats.mode & constants.S_ISUID ? parentStats.uid : uid,
			gid: parentStats.mode & constants.S_ISGID ? parentStats.gid : gid,
		});
		return new Handle(this, path, fs, resolved, flag, inode);
	}

	if (checkAccess && (!hasAccess(this, stats, mode) || !hasAccess(this, stats, flags.toMode(flag)))) {
		throw UV('EACCES', 'open', path);
	}

	if (flag & constants.O_EXCL) throw UV('EEXIST', 'open', path);

	const file = new Handle(this, path, fs, resolved, flag, stats);

	if (!opt.allowDirectory && stats.mode & constants.S_IFDIR) throw UV('EISDIR', 'open', path);

	if (flag & constants.O_TRUNC) file.truncateSync(0);

	return file;
}

export function readlink(this: V_Context, path: PathLike): string {
	path = normalizePath(path);

	const { fs, stats, path: resolved } = resolve(this, path, true);

	if (!stats) throw UV('ENOENT', 'readlink', path);
	if (checkAccess && !hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', 'readlink', path);
	if (!isSymbolicLink(stats)) throw UV('EINVAL', 'readlink', path);
	const size = stats.size;
	const data = new Uint8Array(size);
	fs.readSync(resolved, data, 0, size);
	return decodeUTF8(data);
}

export function mkdir(this: V_Context, path: PathLike, options: MkdirOptions = {}): string | void {
	path = normalizePath(path);
	const { fs, path: resolved } = resolve(this, path);

	const { euid: uid, egid: gid } = contextOf(this).credentials;

	const { mode = 0o777, recursive } = options;

	const __create = (path: string, resolved: string, parent: InodeLike) => {
		if (checkAccess && !hasAccess(this, parent, constants.W_OK)) throw UV('EACCES', 'mkdir', dirname(path));

		const inode = fs.mkdirSync(resolved, {
			mode,
			uid: parent.mode & constants.S_ISUID ? parent.uid : uid,
			gid: parent.mode & constants.S_ISGID ? parent.gid : gid,
		});

		emitChange(this, 'rename', path);
		return inode;
	};

	if (!recursive) {
		__create(path, resolved, fs.statSync(dirname(resolved)));
		return;
	}

	const dirs: { resolved: string; original: string }[] = [];
	for (let dir = resolved, original = path; !fs.existsSync(dir); dir = dirname(dir), original = dirname(original)) {
		dirs.unshift({ resolved: dir, original });
	}

	if (!dirs.length) return;

	const stats: InodeLike[] = [fs.statSync(dirname(dirs[0].resolved))];

	for (const [i, dir] of dirs.entries()) {
		stats.push(__create(dir.original, dir.resolved, stats[i]));
	}
	return dirs[0].original;
}

export function readdir(this: V_Context, path: PathLike, options: ReaddirOptions = {}): Dirent[] {
	path = normalizePath(path);

	const { fs, path: resolved } = resolve(this, path);

	const stats = fs.statSync(resolved);
	if (checkAccess && !hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', 'readdir', path);

	if (!isDirectory(stats)) throw UV('ENOTDIR', 'readdir', path);
	const entries = fs.readdirSync(resolved);

	// Iterate over entries and handle recursive case if needed
	const values: Dirent[] = [];

	const addEntry = (entry: string) => {
		let entryStat: InodeLike;
		try {
			entryStat = fs.statSync(join(resolved, entry));
		} catch (e: any) {
			if (e.code == 'ENOENT') return;
			throw e;
		}

		const ent = new Dirent();
		ent.ino = entryStat.ino;
		ent.type = ifToDt(entryStat.mode);
		ent.path = entry;
		ent.name = basename(entry);
		values.push(ent);

		if (!isDirectory(entryStat) || !options?.recursive) return;

		const children = fs.readdirSync(join(resolved, entry));
		for (const child of children) addEntry(join(entry, child));
	};

	for (const entry of entries) addEntry(entry);

	return values;
}

export function rename(this: V_Context, oldPath: PathLike, newPath: PathLike): void {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const $ex = { syscall: 'rename', path: oldPath, dest: newPath };
	const src = resolve(this, oldPath, true, $ex);
	const dst = resolveMount(newPath, this, $ex);

	if (src.fs.uuid !== dst.fs.uuid) throw UV('EXDEV', $ex);
	if (dst.path.startsWith(src.path + '/')) throw UV('EBUSY', $ex);
	if (!src.stats) throw UV('ENOENT', $ex);

	const fs = src.fs;

	const oldParent = fs.statSync(dirname(src.path));
	const newParent = fs.statSync(dirname(dst.path));

	let newStats: InodeLike | undefined;
	try {
		newStats = fs.statSync(dst.path);
	} catch (e: any) {
		if (e.code != 'ENOENT') throw e;
	}

	if (checkAccess && (!hasAccess(this, oldParent, constants.R_OK) || !hasAccess(this, newParent, constants.W_OK))) throw UV('EACCES', $ex);

	if (newStats && !isDirectory(src.stats) && isDirectory(newStats)) throw UV('EISDIR', $ex);
	if (newStats && isDirectory(src.stats) && !isDirectory(newStats)) throw UV('ENOTDIR', $ex);

	src.fs.renameSync(src.path, dst.path);

	emitChange(this, 'rename', oldPath);
	emitChange(this, 'change', newPath);
}

export function link(this: V_Context, target: PathLike, link: PathLike): void {
	target = normalizePath(target);
	link = normalizePath(link);

	const $ex = { syscall: 'link', path: link, dest: target };
	const { fs, path: resolved } = resolveMount(target, this, $ex);
	const dst = resolveMount(link, this, $ex);

	if (fs.uuid !== dst.fs.uuid) throw UV('EXDEV', $ex);

	const stats = fs.statSync(resolved);

	if (checkAccess) {
		if (!hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', $ex);

		const dirStats = fs.statSync(dirname(resolved));
		if (!hasAccess(this, dirStats, constants.R_OK)) throw UV('EACCES', $ex);

		const destStats = fs.statSync(dirname(dst.path));
		if (!hasAccess(this, destStats, constants.W_OK)) throw UV('EACCES', $ex);
	}

	return fs.linkSync(resolved, dst.path);
}
