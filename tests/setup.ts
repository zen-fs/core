// SPDX-License-Identifier: LGPL-3.0-or-later
import { fs as _fs } from '@zenfs/core';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { NodeFS } from '@zenfs/core/node/types.js';

export const data = join(import.meta.dirname, 'data');

export const tmp = join(import.meta.dirname, 'tmp');

if (!existsSync(tmp)) mkdirSync(tmp);

export async function copyAsync(_path: string, fs: NodeFS = _fs): Promise<void> {
	const path = relative(data, _path) || '/';
	const stats = statSync(_path);

	if (!stats.isDirectory()) {
		await fs.promises.writeFile(path, readFileSync(_path));
		return;
	}

	if (path != '/') {
		await fs.promises.mkdir(path);
	}
	for (const file of readdirSync(_path)) {
		await copyAsync(join(_path, file), fs);
	}
}

export function copySync(_path: string, fs: NodeFS = _fs): void {
	const path = relative(data, _path) || '/';
	const stats = statSync(_path);

	if (!stats.isDirectory()) {
		fs.writeFileSync(path, readFileSync(_path));
		return;
	}

	if (path != '/') {
		fs.mkdirSync(path);
	}
	for (const file of readdirSync(_path)) {
		copySync(join(_path, file), fs);
	}
}

/**
 * @deprecated @hidden
 */
export const copy = copySync;
