import { join, relative } from 'node:path';
import { statSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fs as _fs } from '../dist/index.js';
import * as log from '../dist/log.js';

export const data = join(import.meta.dirname, 'data');

export const tmp = join(import.meta.dirname, 'tmp');

if (!existsSync(tmp)) mkdirSync(tmp);

export async function copyAsync(_path: string, fs: typeof _fs = _fs): Promise<void> {
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

export function copySync(_path: string, fs: typeof _fs = _fs): void {
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

export const logConfig: log.LogConfiguration = {
	enabled: true,
	output: console.error,
	format(entry) {
		const time = (entry.elapsedMs / 1000).toFixed(3).padStart(10);
		const levelColor = entry.level < log.Level.WARN ? 31 : entry.level > log.Level.WARN ? 36 : 33;
		const level = `\x1b[1;${levelColor}m${log.levels[entry.level].toUpperCase()}\x1b[0m`;
		return `[${time}] ${level} ${entry.message}`;
	},
	level: log.Level.INFO,
	dumpBacklog: true,
};
