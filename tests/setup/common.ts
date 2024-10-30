import { join, relative } from 'node:path';
import { statSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fs } from '../../dist/index.js';

export const data = join(import.meta.dirname, '../data');

export const tmp = join(import.meta.dirname, '../tmp');

if (!existsSync(tmp)) {
	mkdirSync(tmp);
}

export function copy(_path: string) {
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
		copy(join(_path, file));
	}
}
