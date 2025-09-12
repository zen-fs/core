// SPDX-License-Identifier: LGPL-3.0-or-later
import type { PathLike } from 'node:fs';
import type { V_Context } from '../internal/contexts.js';
import type { MkdirOptions, OpenOptions, ReaddirOptions, ResolvedPath } from './shared.js';

import { rethrow, setUVMessage, UV, type Exception } from 'kerium';
import * as constants from '../constants.js';
import { defaultContext } from '../internal/contexts.js';
import { hasAccess, isDirectory, isSymbolicLink, type InodeLike } from '../internal/inode.js';
import { basename, dirname, join, parse, resolve as resolvePath } from '../path.js';
import { normalizeMode, normalizePath } from '../utils.js';
import { checkAccess } from './config.js';
import { Dirent, ifToDt } from './dir.js';
import { Handle } from './file.js';
import * as flags from './flags.js';
import { resolveMount } from './shared.js';
import { emitChange } from './watchers.js';
import { decodeUTF8 } from 'utilium';

/**
 * Resolves the mount and real path for a path.
 * Additionally, any stats fetched will be returned for de-duplication
 * @internal @hidden
 */
export async function resolve($: V_Context, path: string, preserveSymlinks?: boolean): Promise<ResolvedPath> {
	if (preserveSymlinks) {
		const resolved = resolveMount(path, $);
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

		const target = resolvePath.call($, dirname(path), (await readlink.call($, path)).toString());
		return await resolve($, target);
	} catch {
		// Go the long way
	}

	const { base, dir } = parse(path);
	const realDir = dir == '/' ? '/' : (await resolve($, dir)).fullPath;
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

	const target = resolvePath.call($, realDir, (await readlink.call($, maybePath)).toString());
	return await resolve($, target);
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
	const { fs, path: resolved, stats } = await resolve($, path.toString(), opt.preserveSymlinks);

	if (!stats) {
		if (!(flag & constants.O_CREAT)) throw UV('ENOENT', $ex);

		// Create the file
		const parentStats = await fs.stat(dirname(resolved));
		if (checkAccess && !hasAccess($, parentStats, constants.W_OK)) throw UV('EACCES', 'open', dirname(path));

		if (!isDirectory(parentStats)) throw UV('ENOTDIR', 'open', dirname(path));

		if (!opt.allowDirectory && mode & constants.S_IFDIR) throw UV('EISDIR', 'open', path);

		const { euid: uid, egid: gid } = $?.credentials ?? defaultContext.credentials;

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

	const { fs, stats, path: resolved } = await resolve(this, path, true);

	if (!stats) throw UV('ENOENT', 'readlink', path);
	if (checkAccess && !hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', 'readlink', path);
	if (!isSymbolicLink(stats)) throw UV('EINVAL', 'readlink', path);
	const size = stats.size;
	const data = new Uint8Array(size);
	await fs.read(resolved, data, 0, size);
	return decodeUTF8(data);
}

export async function mkdir(this: V_Context, path: PathLike, options: MkdirOptions = {}): Promise<string | void> {
	path = normalizePath(path);
	const { euid: uid, egid: gid } = this?.credentials ?? defaultContext.credentials;
	const { mode = 0o777, recursive } = options;

	const { fs, path: resolved } = resolveMount(path, this);

	const __create = async (path: string, resolved: string, parent: InodeLike) => {
		if (checkAccess && !hasAccess(this, parent, constants.W_OK)) throw UV('EACCES', 'mkdir', dirname(path));

		const inode = await fs
			.mkdir(resolved, {
				mode,
				uid: parent.mode & constants.S_ISUID ? parent.uid : uid,
				gid: parent.mode & constants.S_ISGID ? parent.gid : gid,
			})
			.catch(rethrow({ syscall: 'mkdir', path }));
		emitChange(this, 'rename', path);
		return inode;
	};

	if (!recursive) {
		await __create(path, resolved, await fs.stat(dirname(resolved)).catch(rethrow({ path: dirname(path) })));
		return;
	}

	const dirs: [path: string, resolved: string][] = [];
	let origDir = path;
	for (
		let dir = resolved;
		!(await fs.exists(dir).catch(rethrow({ syscall: 'exists', path: origDir })));
		dir = dirname(dir), origDir = dirname(origDir)
	) {
		dirs.unshift([origDir, dir]);
	}

	if (!dirs.length) return;

	const stats: InodeLike[] = [await fs.stat(dirname(dirs[0][1])).catch(rethrow({ syscall: 'stat', path: dirname(dirs[0][0]) }))];

	for (const [i, [path, resolved]] of dirs.entries()) {
		stats.push(await __create(path, resolved, stats[i]));
	}
	return dirs[0][0];
}

export async function readdir(this: V_Context, path: PathLike, options: ReaddirOptions = {}): Promise<Dirent[]> {
	path = normalizePath(path);

	const { fs, path: resolved, stats } = await resolve(this, path);
	const $ex = { syscall: 'readdir', path };

	if (!stats) throw UV('ENOENT', $ex);

	if (checkAccess && !hasAccess(this, stats, constants.R_OK)) throw UV('EACCES', $ex);

	if (!isDirectory(stats)) throw UV('ENOTDIR', $ex);

	const entries = await fs.readdir(resolved).catch(rethrow($ex));

	const values: Dirent[] = [];
	const addEntry = async (entry: string) => {
		const entryStats = await fs.stat(join(resolved, entry)).catch((e: Exception): undefined => {
			if (e.code == 'ENOENT') return;
			throw setUVMessage(Object.assign(e, { syscall: 'stat', path: join(path, entry) }));
		});

		if (!entryStats) return;

		const ent = new Dirent();
		ent.ino = entryStats.ino;
		ent.type = ifToDt(entryStats.mode);
		ent.path = entry;
		ent.name = basename(entry);
		values.push(ent);

		if (!options.recursive || !isDirectory(entryStats)) return;

		const children = await fs.readdir(join(resolved, entry)).catch(rethrow({ syscall: 'readdir', path: join(path, entry) }));
		for (const child of children) await addEntry(join(entry, child));
	};
	await Promise.all(entries.map(addEntry));
	return values;
}

export async function rename(this: V_Context, oldPath: PathLike, newPath: PathLike): Promise<void> {
	oldPath = normalizePath(oldPath);
	newPath = normalizePath(newPath);
	const $ex = { syscall: 'rename', path: oldPath, dest: newPath };
	const src = await resolve(this, oldPath, true);
	const dst = resolveMount(newPath, this);

	if (src.fs !== dst.fs) throw UV('EXDEV', $ex);
	if (dst.path.startsWith(src.path + '/')) throw UV('EBUSY', $ex);
	if (!src.stats) throw UV('ENOENT', $ex);

	const fs = src.fs;

	const oldParent = await fs.stat(dirname(src.path)).catch(rethrow($ex));
	const newParent = await fs.stat(dirname(dst.path)).catch(rethrow($ex));
	const newStats = await fs.stat(dst.path).catch((e: Exception) => {
		if (e.code == 'ENOENT') return null;
		throw setUVMessage(Object.assign(e, $ex));
	});

	if (checkAccess && (!hasAccess(this, oldParent, constants.R_OK) || !hasAccess(this, newParent, constants.W_OK))) throw UV('EACCES', $ex);

	if (newStats && !isDirectory(src.stats) && isDirectory(newStats)) throw UV('EISDIR', $ex);
	if (newStats && isDirectory(src.stats) && !isDirectory(newStats)) throw UV('ENOTDIR', $ex);

	await src.fs.rename(src.path, dst.path).catch(rethrow($ex));

	emitChange(this, 'rename', oldPath);
	emitChange(this, 'change', newPath);
}
