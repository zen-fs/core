// SPDX-License-Identifier: LGPL-3.0-or-later
// Lists every directory of a Fetch mount, whose metadata is an `Index`.

import { configureSingle, Fetch, Index, Inode } from '@zenfs/core';
import { S_IFDIR, S_IFREG } from '@zenfs/core/constants';
import { fs } from './common.ts';

interface Config {
	directories: number;
	/** Files in each directory */
	files: number;
}

export async function setup(config: Config): Promise<void> {
	const index = new Index();
	let ino = 0n;
	index.set('/', new Inode({ ino: ino++, mode: S_IFDIR | 0o755, nlink: 1 }));
	for (let dir = 0; dir < config.directories; dir++) {
		index.set(`/d${dir}`, new Inode({ ino: ino++, mode: S_IFDIR | 0o755, nlink: 1 }));
		for (let file = 0; file < config.files; file++) {
			index.set(`/d${dir}/f${file}`, new Inode({ ino: ino++, mode: S_IFREG | 0o644, nlink: 1 }));
		}
	}

	await configureSingle({ backend: Fetch, baseUrl: 'http://localhost:1', index: index.toJSON(), disableAsyncCache: true });
}

export async function test(config: Config) {
	for (let dir = 0; dir < config.directories; dir++) await fs.promises.readdir(`/d${dir}`);
	return { directories: config.directories };
}
